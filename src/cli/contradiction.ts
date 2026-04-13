/**
 * Contradiction detector v2 (D41 — topic-clustered claim comparison).
 *
 * Two-phase pipeline:
 *   Phase A (claims.ts): Per-file LLM extraction of {topic, claims[]}
 *   Phase B (this file): Group claims by topic, compare cross-file via LLM
 *
 * Topic dedup uses embedding cosine similarity > threshold (default 0.85)
 * to merge terminology variants like "OAuth2" / "OAuth 2.0".
 */

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { DbBundle } from '../db/client.js';
import type { LlmProvider } from '../llm/provider.js';
import type { Embedder } from '../retrieval/embedder.js';
import { logger } from '../observability/logger.js';
import type { ProgressReporter } from './progress.js';

// ----------------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------------

export interface ContradictionScanOpts {
  bundle: DbBundle;
  scope: 'project' | 'personal';
  llmProvider: LlmProvider;
  wikiRoot: string;
  embedder?: Embedder;
  topicSimilarity?: number;
  progress?: ProgressReporter;
}

export interface Contradiction {
  topic: string;
  claimA: { claim: string; source_uri: string };
  claimB: { claim: string; source_uri: string };
  explanation: string;
  confidence: 'high' | 'medium';
}

export interface ContradictionResult {
  scanned_pairs: number;
  topics_scanned: number;
  claims_extracted: number;
  contradictions: Contradiction[];
  rate_limited: boolean;
}

const RATE_LIMIT_MS = 60 * 60 * 1000; // 1 hour
const DEFAULT_TOPIC_SIMILARITY = 0.85;

const COMPARE_SYSTEM = `You are a contradiction detector for a knowledge wiki. Given claims about a topic from different wiki files, identify any contradictions — places where two files make incompatible factual statements.

Return ONLY valid JSON:
{"contradictions":[{"claim_a":"exact claim text","source_a":"file","claim_b":"exact claim text","source_b":"file","explanation":"why these contradict","confidence":"high"|"medium"}]}

Rules:
- Only report genuine factual contradictions, not differences in emphasis or scope
- "high" confidence = clear logical incompatibility
- "medium" confidence = likely contradiction but could be context-dependent
- If no contradictions, return {"contradictions":[]}`;

// ----------------------------------------------------------------------------
// Main entry point
// ----------------------------------------------------------------------------

/**
 * Run contradiction scan using topic-clustered claim comparison (D41).
 * Requires claims to be extracted first (via extractAllClaims).
 */
export async function contradictionScan(
  opts: ContradictionScanOpts,
): Promise<ContradictionResult> {
  const { bundle, scope, llmProvider, wikiRoot, progress } = opts;
  const threshold = opts.topicSimilarity ?? DEFAULT_TOPIC_SIMILARITY;

  // Rate limit check
  const lastScan = bundle.writer
    .prepare<[string], { value: string }>(
      `SELECT value FROM pinakes_meta WHERE key = ?`,
    )
    .get('last_contradiction_scan');

  if (lastScan) {
    const lastTs = parseInt(lastScan.value, 10);
    if (Date.now() - lastTs < RATE_LIMIT_MS) {
      return { scanned_pairs: 0, topics_scanned: 0, claims_extracted: 0, contradictions: [], rate_limited: true };
    }
  }

  // Get all claims grouped by topic
  const allClaims = bundle.writer
    .prepare<[string], { topic: string; claim: string; source_uri: string }>(
      `SELECT topic, claim, source_uri FROM pinakes_claims WHERE scope = ? ORDER BY topic`,
    )
    .all(scope);

  if (allClaims.length === 0) {
    return { scanned_pairs: 0, topics_scanned: 0, claims_extracted: 0, contradictions: [], rate_limited: false };
  }

  // Group claims by topic
  let topicGroups = groupByTopic(allClaims);

  // Topic dedup via embeddings (merge "OAuth2" and "OAuth 2.0")
  if (opts.embedder) {
    topicGroups = await deduplicateTopics(topicGroups, opts.embedder, threshold);
  }

  // Filter to topics with claims from 2+ files (cross-file contradictions only)
  const crossFileTopics = topicGroups.filter((g) => {
    const uniqueFiles = new Set(g.claims.map((c) => c.source_uri));
    return uniqueFiles.size >= 2;
  });

  const contradictions: Contradiction[] = [];
  let scanned = 0;

  progress?.startPhase('Phase 1/3: Comparing claims across topics', crossFileTopics.length);

  for (const group of crossFileTopics) {
    const uniqueFiles = new Set(group.claims.map((c) => c.source_uri));
    try {
      const prompt = formatComparisonPrompt(group);
      const response = await llmProvider.complete({
        system: COMPARE_SYSTEM,
        prompt,
        maxTokens: 500,
      });

      const parsed = parseContradictionResponse(response);
      for (const c of parsed) {
        contradictions.push({
          topic: group.topic,
          claimA: { claim: c.claim_a, source_uri: c.source_a },
          claimB: { claim: c.claim_b, source_uri: c.source_b },
          explanation: c.explanation,
          confidence: c.confidence as 'high' | 'medium',
        });
      }

      scanned++;
      progress?.tick(
        group.topic,
        `${group.claims.length} claims from ${uniqueFiles.size} files — ${parsed.length > 0 ? `${parsed.length} CONTRADICTION(S)` : 'clean'}`,
      );
    } catch (err) {
      logger.warn({ err, topic: group.topic }, 'contradiction comparison failed for topic');
      progress?.tick(group.topic, `failed: ${err instanceof Error ? err.message.slice(0, 60) : err}`);
    }
  }

  progress?.endPhase(`${contradictions.length} contradictions found across ${scanned} topics`);

  // Update rate limit timestamp
  bundle.writer
    .prepare(`INSERT OR REPLACE INTO pinakes_meta (key, value) VALUES ('last_contradiction_scan', ?)`)
    .run(String(Date.now()));

  // Write report if contradictions found
  if (contradictions.length > 0) {
    writeContradictionReport(wikiRoot, contradictions);
  }

  return {
    scanned_pairs: scanned,
    topics_scanned: crossFileTopics.length,
    claims_extracted: allClaims.length,
    contradictions,
    rate_limited: false,
  };
}

// ----------------------------------------------------------------------------
// Topic grouping + dedup
// ----------------------------------------------------------------------------

interface TopicGroup {
  topic: string;
  claims: Array<{ claim: string; source_uri: string }>;
}

function groupByTopic(
  claims: Array<{ topic: string; claim: string; source_uri: string }>,
): TopicGroup[] {
  const map = new Map<string, TopicGroup>();
  for (const c of claims) {
    const key = c.topic.toLowerCase();
    let group = map.get(key);
    if (!group) {
      group = { topic: c.topic, claims: [] };
      map.set(key, group);
    }
    group.claims.push({ claim: c.claim, source_uri: c.source_uri });
  }
  return [...map.values()];
}

/**
 * Merge topic groups whose topic strings are semantically similar
 * (cosine similarity > threshold). Handles "OAuth2" / "OAuth 2.0" merging.
 */
export async function deduplicateTopics(
  groups: TopicGroup[],
  embedder: Embedder,
  threshold: number,
): Promise<TopicGroup[]> {
  if (groups.length <= 1) return groups;

  // Embed all topic strings
  const embeddings: Float32Array[] = [];
  for (const g of groups) {
    embeddings.push(await embedder.embed(g.topic));
  }

  // Union-find for merging
  const parent = groups.map((_, i) => i);
  function find(i: number): number {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]!]!;
      i = parent[i]!;
    }
    return i;
  }
  function union(a: number, b: number): void {
    parent[find(b)] = find(a);
  }

  // Compare all pairs
  for (let i = 0; i < groups.length; i++) {
    for (let j = i + 1; j < groups.length; j++) {
      const sim = cosineSimilarity(embeddings[i]!, embeddings[j]!);
      if (sim > threshold) {
        union(i, j);
      }
    }
  }

  // Merge groups
  const merged = new Map<number, TopicGroup>();
  for (let i = 0; i < groups.length; i++) {
    const root = find(i);
    let target = merged.get(root);
    if (!target) {
      target = { topic: groups[root]!.topic, claims: [] };
      merged.set(root, target);
    }
    target.claims.push(...groups[i]!.claims);
  }

  return [...merged.values()];
}

function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

// ----------------------------------------------------------------------------
// LLM prompt + response parsing
// ----------------------------------------------------------------------------

function formatComparisonPrompt(group: TopicGroup): string {
  const lines = [`Topic: "${group.topic}"\n\nClaims from different files:\n`];
  for (const c of group.claims) {
    lines.push(`- [${c.source_uri}]: "${c.claim}"`);
  }
  return lines.join('\n');
}

interface ParsedContradiction {
  claim_a: string;
  source_a: string;
  claim_b: string;
  source_b: string;
  explanation: string;
  confidence: string;
}

export function parseContradictionResponse(response: string): ParsedContradiction[] {
  try {
    const fenceMatch = response.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
    const jsonStr = fenceMatch ? fenceMatch[1]! : response;

    const objMatch = jsonStr.match(/\{[\s\S]*\}/);
    if (!objMatch) return [];

    const parsed = JSON.parse(objMatch[0]) as { contradictions?: ParsedContradiction[] };
    if (!Array.isArray(parsed.contradictions)) return [];

    return parsed.contradictions.filter(
      (c): c is ParsedContradiction =>
        typeof c.claim_a === 'string' &&
        typeof c.claim_b === 'string' &&
        typeof c.explanation === 'string' &&
        (c.confidence === 'high' || c.confidence === 'medium'),
    );
  } catch {
    return [];
  }
}

// ----------------------------------------------------------------------------
// Report output
// ----------------------------------------------------------------------------

function writeContradictionReport(wikiRoot: string, contradictions: Contradiction[]): void {
  const lines = [
    '# Detected Contradictions',
    '',
    `*Last scanned: ${new Date().toISOString()}*`,
    '',
  ];

  // Group by topic
  const byTopic = new Map<string, Contradiction[]>();
  for (const c of contradictions) {
    const list = byTopic.get(c.topic) ?? [];
    list.push(c);
    byTopic.set(c.topic, list);
  }

  for (const [topic, items] of byTopic) {
    lines.push(`## ${topic}`);
    lines.push('');
    for (const c of items) {
      lines.push(`- **${c.claimA.source_uri}**: "${c.claimA.claim}"`);
      lines.push(`- **${c.claimB.source_uri}**: "${c.claimB.claim}"`);
      lines.push(`- **Explanation**: ${c.explanation} (${c.confidence} confidence)`);
      lines.push('');
    }
  }

  writeFileSync(join(wikiRoot, 'contradictions.md'), lines.join('\n'), 'utf8');
}

// Export internals for testing
export { groupByTopic as _groupByTopic, cosineSimilarity as _cosineSimilarity };
