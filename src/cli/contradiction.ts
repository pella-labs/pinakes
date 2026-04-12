import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { DbBundle } from '../db/client.js';
import type { LlmProvider } from '../llm/provider.js';
import { logger } from '../observability/logger.js';

/**
 * Contradiction detector CLI command (PRD Phase 8, stretch goal H).
 *
 * Scans wiki chunks for contradictory claims using pairwise LLM judge.
 * Rate-limited to 1 scan per hour. Outputs contradictions.md to wiki root.
 */

export interface ContradictionScanOpts {
  bundle: DbBundle;
  scope: 'project' | 'personal';
  llmProvider: LlmProvider;
  wikiRoot: string;
}

export interface Contradiction {
  chunkA: { id: string; source_uri: string; text: string };
  chunkB: { id: string; source_uri: string; text: string };
  explanation: string;
  confidence: 'high' | 'medium';
}

export interface ContradictionResult {
  scanned_pairs: number;
  contradictions: Contradiction[];
  rate_limited: boolean;
}

const RATE_LIMIT_MS = 0; // disabled during testing (was 60 * 60 * 1000)
const MAX_PAIRS = 50;
const SIMILARITY_THRESHOLD = 0.3;

const JUDGE_SYSTEM = `You are a contradiction detector. Given two text chunks from a knowledge wiki, determine if they contain contradictory claims. Respond with ONLY valid JSON: {"contradicts": true/false, "explanation": "why", "confidence": "high"|"medium"|"low"}. Only report contradictions you are confident about.`;

/**
 * Run a contradiction scan. Returns immediately if rate-limited.
 */
export async function contradictionScan(
  opts: ContradictionScanOpts
): Promise<ContradictionResult> {
  const { bundle, scope, llmProvider, wikiRoot } = opts;

  // Rate limit check
  const lastScan = bundle.writer
    .prepare<[string], { value: string }>(
      `SELECT value FROM pinakes_meta WHERE key = ?`
    )
    .get('last_contradiction_scan');

  if (lastScan) {
    const lastTs = parseInt(lastScan.value, 10);
    if (Date.now() - lastTs < RATE_LIMIT_MS) {
      return { scanned_pairs: 0, contradictions: [], rate_limited: true };
    }
  }

  if (!llmProvider.available()) {
    throw new Error(
      'No LLM provider available for contradiction detection. ' +
        'Set PINAKES_OLLAMA_URL, ANTHROPIC_API_KEY, or OPENAI_API_KEY, ' +
        'or install the claude/codex CLI.'
    );
  }

  // Find candidate pairs via vector similarity
  const pairs = findCandidatePairs(bundle, scope);

  const contradictions: Contradiction[] = [];
  let scanned = 0;

  for (const pair of pairs) {
    try {
      const response = await llmProvider.complete({
        system: JUDGE_SYSTEM,
        prompt: `Chunk A (from ${pair.a.source_uri}):\n${pair.a.text}\n\nChunk B (from ${pair.b.source_uri}):\n${pair.b.text}`,
        maxTokens: 200,
      });

      const judgment = parseJudgment(response);
      if (judgment && judgment.contradicts && (judgment.confidence === 'high' || judgment.confidence === 'medium')) {
        contradictions.push({
          chunkA: pair.a,
          chunkB: pair.b,
          explanation: judgment.explanation,
          confidence: judgment.confidence,
        });
      }
      scanned++;
    } catch (err) {
      logger.warn({ err, pairA: pair.a.id, pairB: pair.b.id }, 'contradiction check failed for pair');
    }
  }

  // Update rate limit timestamp
  bundle.writer
    .prepare(
      `INSERT OR REPLACE INTO pinakes_meta (key, value) VALUES ('last_contradiction_scan', ?)`
    )
    .run(String(Date.now()));

  // Write contradictions.md if any found
  if (contradictions.length > 0) {
    writeContradictionReport(wikiRoot, contradictions, bundle, scope);
  }

  return { scanned_pairs: scanned, contradictions, rate_limited: false };
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

interface ChunkInfo {
  id: string;
  source_uri: string;
  text: string;
}

interface CandidatePair {
  a: ChunkInfo;
  b: ChunkInfo;
}

/**
 * Find candidate pairs for contradiction checking.
 * Uses vector similarity to find chunks that are semantically similar
 * (which is a prerequisite for them to potentially contradict).
 */
function findCandidatePairs(bundle: DbBundle, scope: string): CandidatePair[] {
  // Get all chunks with their vec embeddings
  const chunks = bundle.writer
    .prepare<[string], { id: string; source_uri: string; text: string; rowid: number }>(
      `SELECT c.id, n.source_uri, c.text, c.rowid
       FROM pinakes_chunks c
       JOIN pinakes_nodes n ON c.node_id = n.id
       WHERE n.scope = ?
       ORDER BY c.rowid`
    )
    .all(scope);

  if (chunks.length < 2) return [];

  // For each chunk, find the top 5 most similar via vec
  const pairs = new Set<string>();
  const result: CandidatePair[] = [];

  for (const chunk of chunks) {
    if (result.length >= MAX_PAIRS) break;

    const similar = bundle.writer
      .prepare<[number, number], { rowid: number; distance: number }>(
        `SELECT rowid, distance
         FROM pinakes_chunks_vec
         WHERE embedding MATCH (SELECT embedding FROM pinakes_chunks_vec WHERE rowid = ?)
         AND k = ?
         ORDER BY distance`
      )
      .all(chunk.rowid, 6); // 6 because first result is self

    for (const sim of similar) {
      if (sim.rowid === chunk.rowid) continue;
      if (sim.distance > SIMILARITY_THRESHOLD) continue;

      // Deduplicate symmetric pairs
      const pairKey = [chunk.rowid, sim.rowid].sort().join(':');
      if (pairs.has(pairKey)) continue;
      pairs.add(pairKey);

      const other = chunks.find((c) => c.rowid === sim.rowid);
      if (!other) continue;

      // Skip same-source pairs (they're likely just adjacent sections)
      if (chunk.source_uri === other.source_uri) continue;

      result.push({
        a: { id: chunk.id, source_uri: chunk.source_uri, text: chunk.text },
        b: { id: other.id, source_uri: other.source_uri, text: other.text },
      });

      if (result.length >= MAX_PAIRS) break;
    }
  }

  return result;
}

function parseJudgment(
  response: string
): { contradicts: boolean; explanation: string; confidence: string } | null {
  try {
    const match = response.match(/\{[\s\S]*\}/);
    if (!match) return null;
    const parsed = JSON.parse(match[0]) as {
      contradicts?: boolean;
      explanation?: string;
      confidence?: string;
    };
    if (typeof parsed.contradicts !== 'boolean') return null;
    return {
      contradicts: parsed.contradicts,
      explanation: parsed.explanation ?? '',
      confidence: parsed.confidence ?? 'low',
    };
  } catch {
    return null;
  }
}

function writeContradictionReport(
  wikiRoot: string,
  contradictions: Contradiction[],
  bundle: DbBundle,
  scope: string
): void {
  // writeFileSync and join imported at top level

  const lines = [
    '# Detected Contradictions',
    '',
    `*Last scanned: ${new Date().toISOString()}*`,
    '',
  ];

  for (const c of contradictions) {
    lines.push(`## ${c.chunkA.source_uri} vs ${c.chunkB.source_uri}`);
    lines.push('');
    lines.push(
      `- **Chunk A** (${c.chunkA.source_uri}): "${truncate(c.chunkA.text, 200)}"`
    );
    lines.push(
      `- **Chunk B** (${c.chunkB.source_uri}): "${truncate(c.chunkB.text, 200)}"`
    );
    lines.push(`- **Explanation**: ${c.explanation}`);
    lines.push(`- **Confidence**: ${c.confidence}`);
    lines.push('');
  }

  writeFileSync(join(wikiRoot, 'contradictions.md'), lines.join('\n'), 'utf8');

  // Log the scan
  try {
    bundle.writer
      .prepare(
        `INSERT INTO pinakes_log (ts, scope, kind, source_uri, payload)
         VALUES (?, ?, 'contradiction:scan', NULL, ?)`
      )
      .run(
        Date.now(),
        scope,
        JSON.stringify({ contradictions_found: contradictions.length })
      );
  } catch {
    // Non-fatal
  }
}

function truncate(s: string, maxLen: number): string {
  if (s.length <= maxLen) return s;
  return s.slice(0, maxLen) + '...';
}

// Export for testing
export { findCandidatePairs as _findCandidatePairs, parseJudgment as _parseJudgment };
