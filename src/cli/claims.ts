/**
 * Topic-claim extraction for the audit-wiki v2 contradiction pipeline (D41).
 *
 * Phase A of the two-phase pipeline:
 * 1. For each wiki file, send content to LLM → extract {topic, claims[]} pairs
 * 2. Persist claims to `pinakes_claims` table
 * 3. Skip unchanged files (incremental via source_sha comparison)
 */

import type { Database as BetterSqliteDatabase } from 'better-sqlite3';

import type { LlmProvider } from '../llm/provider.js';
import { logger } from '../observability/logger.js';

// ----------------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------------

export interface ExtractedClaim {
  topic: string;
  claim: string;
  source_uri: string;
}

interface TopicClaims {
  topic: string;
  claims: string[];
}

export interface ClaimExtractionResult {
  files_processed: number;
  files_skipped: number;
  claims_extracted: number;
}

// ----------------------------------------------------------------------------
// Extraction prompt
// ----------------------------------------------------------------------------

const EXTRACTION_SYSTEM = `You are a claim extractor for a knowledge wiki. Given the content of a wiki page, identify the key topics discussed and extract factual claims made about each topic.

Return ONLY valid JSON in this format:
{"topics":[{"topic":"topic name","claims":["claim 1","claim 2"]}]}

Rules:
- Use the most canonical, commonly-used name for each topic (e.g., "authentication" not "auth flow")
- Each claim should be a single, self-contained factual statement
- Only extract concrete claims (numbers, versions, choices, constraints), not vague descriptions
- Group related subtopics under their parent topic
- Limit to the 5-10 most important topics per page
- Each topic should have 1-5 claims`;

// ----------------------------------------------------------------------------
// Core extraction
// ----------------------------------------------------------------------------

/**
 * Extract topics and claims from a single file's content via LLM.
 */
export async function extractClaimsFromFile(
  content: string,
  sourceUri: string,
  llmProvider: LlmProvider,
): Promise<ExtractedClaim[]> {
  const prompt = `Extract topics and claims from this wiki page:\n\n---\n${content.slice(0, 12000)}\n---`;

  const response = await llmProvider.complete({
    system: EXTRACTION_SYSTEM,
    prompt,
    maxTokens: 2000,
  });

  const parsed = parseExtractionResponse(response);
  if (!parsed) return [];

  const claims: ExtractedClaim[] = [];
  for (const tc of parsed) {
    for (const claim of tc.claims) {
      claims.push({
        topic: tc.topic.toLowerCase().trim(),
        claim: claim.trim(),
        source_uri: sourceUri,
      });
    }
  }

  return claims;
}

/**
 * Parse LLM response, handling JSON wrapped in markdown code fences.
 */
export function parseExtractionResponse(response: string): TopicClaims[] | null {
  try {
    // Try extracting JSON from code fences first
    const fenceMatch = response.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
    const jsonStr = fenceMatch ? fenceMatch[1]! : response;

    // Find the JSON object
    const objMatch = jsonStr.match(/\{[\s\S]*\}/);
    if (!objMatch) return null;

    const parsed = JSON.parse(objMatch[0]) as { topics?: TopicClaims[] };
    if (!Array.isArray(parsed.topics)) return null;

    // Validate structure
    return parsed.topics.filter(
      (t): t is TopicClaims =>
        typeof t.topic === 'string' &&
        t.topic.length > 0 &&
        Array.isArray(t.claims) &&
        t.claims.every((c) => typeof c === 'string'),
    );
  } catch {
    return null;
  }
}

// ----------------------------------------------------------------------------
// Persistence + incremental extraction
// ----------------------------------------------------------------------------

/**
 * Extract claims from all wiki files in a scope, persisting to DB.
 * Skips files whose source_sha hasn't changed since last extraction.
 */
export async function extractAllClaims(
  writer: BetterSqliteDatabase,
  scope: string,
  llmProvider: LlmProvider,
  onTick?: (sourceUri: string, detail: string) => void,
): Promise<ClaimExtractionResult> {
  // Get all wiki files with their content and hashes
  const files = writer
    .prepare<[string], { source_uri: string; source_sha: string }>(
      `SELECT source_uri, source_sha FROM pinakes_nodes WHERE scope = ? GROUP BY source_uri`,
    )
    .all(scope);

  const result: ClaimExtractionResult = {
    files_processed: 0,
    files_skipped: 0,
    claims_extracted: 0,
  };

  for (const file of files) {
    // Check if this file was already extracted with the same sha
    const lastExtracted = writer
      .prepare<[string], { value: string }>(
        `SELECT value FROM pinakes_meta WHERE key = ?`,
      )
      .get(`claims_sha:${scope}:${file.source_uri}`);

    if (lastExtracted?.value === file.source_sha) {
      result.files_skipped++;
      onTick?.(file.source_uri, 'skipped (unchanged)');
      continue;
    }

    // Get the full content for this file's chunks
    const chunks = writer
      .prepare<[string, string], { text: string }>(
        `SELECT c.text FROM pinakes_chunks c
         JOIN pinakes_nodes n ON c.node_id = n.id
         WHERE n.scope = ? AND n.source_uri = ?
         ORDER BY c.chunk_index`,
      )
      .all(scope, file.source_uri);

    const content = chunks.map((c) => c.text).join('\n\n');
    if (!content.trim()) {
      onTick?.(file.source_uri, 'skipped (empty)');
      continue;
    }

    try {
      const claims = await extractClaimsFromFile(content, file.source_uri, llmProvider);

      // Delete old claims for this file and insert new ones
      const now = Date.now();
      writer.exec('BEGIN');
      try {
        writer
          .prepare(`DELETE FROM pinakes_claims WHERE scope = ? AND source_uri = ?`)
          .run(scope, file.source_uri);

        const insertStmt = writer.prepare(
          `INSERT INTO pinakes_claims (scope, source_uri, topic, claim, extracted_at)
           VALUES (?, ?, ?, ?, ?)`,
        );
        for (const claim of claims) {
          insertStmt.run(scope, file.source_uri, claim.topic, claim.claim, now);
        }

        // Record the sha so we can skip this file next time
        writer
          .prepare(
            `INSERT OR REPLACE INTO pinakes_meta (key, value) VALUES (?, ?)`,
          )
          .run(`claims_sha:${scope}:${file.source_uri}`, file.source_sha);

        writer.exec('COMMIT');
      } catch (err) {
        writer.exec('ROLLBACK');
        throw err;
      }

      result.files_processed++;
      result.claims_extracted += claims.length;
      onTick?.(file.source_uri, `${claims.length} claims from ${new Set(claims.map((c) => c.topic)).size} topics`);
    } catch (err) {
      logger.warn({ err, source_uri: file.source_uri }, 'claim extraction failed for file');
      onTick?.(file.source_uri, `failed: ${err instanceof Error ? err.message.slice(0, 60) : err}`);
    }
  }

  return result;
}

/**
 * Query all persisted claims for a scope, optionally filtered by topic.
 */
export function queryClaims(
  reader: BetterSqliteDatabase,
  scope: string,
  topic?: string,
): Array<{ id: number; source_uri: string; topic: string; claim: string; extracted_at: number }> {
  if (topic) {
    return reader
      .prepare<[string, string], { id: number; source_uri: string; topic: string; claim: string; extracted_at: number }>(
        `SELECT id, source_uri, topic, claim, extracted_at
         FROM pinakes_claims WHERE scope = ? AND topic = ?
         ORDER BY source_uri`,
      )
      .all(scope, topic);
  }

  return reader
    .prepare<[string], { id: number; source_uri: string; topic: string; claim: string; extracted_at: number }>(
      `SELECT id, source_uri, topic, claim, extracted_at
       FROM pinakes_claims WHERE scope = ?
       ORDER BY topic, source_uri`,
    )
    .all(scope);
}
