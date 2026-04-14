/**
 * Topic-claim extraction with supersession tracking (D41, D51).
 *
 * Phase A of the two-phase pipeline:
 * 1. For each wiki file, send content to LLM → extract {topic, claims[]} pairs
 * 2. Persist claims to `pinakes_claims` table
 * 3. Skip unchanged files (incremental via source_sha comparison)
 *
 * Phase 11.2 adds:
 * - Soft-delete supersession instead of hard-delete
 * - Version chains per (scope, source_uri, topic)
 * - Version chain pruning (max 5 by default)
 * - Confidence adjustments on supersession events
 */

import type { Database as BetterSqliteDatabase } from 'better-sqlite3';

import type { LlmProvider } from '../llm/provider.js';
import { SUPERSESSION_PENALTY, SUPERSESSION_BOOST } from '../gate/confidence.js';
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

export interface ClaimVersion {
  id: number;
  scope: string;
  source_uri: string;
  topic: string;
  claim: string;
  version: number;
  extracted_at: number;
  superseded_by: number | null;
  superseded_at: number | null;
}

export interface SupersededClaim {
  id: number;
  source_uri: string;
  topic: string;
  old_claim: string;
  new_claim: string | null;
  old_version: number;
  new_version: number | null;
  superseded_at: number;
  superseded_by: number | null;
}

// ----------------------------------------------------------------------------
// Constants
// ----------------------------------------------------------------------------

/** Maximum claim versions to keep per (scope, source_uri, topic). */
const MAX_CLAIM_VERSIONS = (() => {
  const env = process.env.PINAKES_MAX_CLAIM_VERSIONS;
  if (env) {
    const parsed = parseInt(env, 10);
    if (!Number.isNaN(parsed) && parsed > 0) return parsed;
  }
  return 5;
})();

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
// Persistence + incremental extraction with supersession
// ----------------------------------------------------------------------------

interface OldClaim {
  id: number;
  topic: string;
  claim: string;
  version: number;
}

/**
 * Extract claims from all wiki files in a scope, persisting to DB.
 * Skips files whose source_sha hasn't changed since last extraction.
 *
 * Phase 11.2: uses soft-delete supersession instead of hard-delete.
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
      const now = Date.now();

      writer.exec('BEGIN');
      try {
        // Step 1: Load old active claims for this file
        const oldClaims = writer
          .prepare<[string, string], OldClaim>(
            `SELECT id, topic, claim, version FROM pinakes_claims
             WHERE scope = ? AND source_uri = ? AND superseded_at IS NULL`,
          )
          .all(scope, file.source_uri);

        // Step 2: Group old claims by topic (lowercased)
        const oldByTopic = new Map<string, OldClaim[]>();
        for (const oc of oldClaims) {
          const key = oc.topic.toLowerCase();
          let list = oldByTopic.get(key);
          if (!list) {
            list = [];
            oldByTopic.set(key, list);
          }
          list.push(oc);
        }

        // Step 3: Insert new claims with version=1, collect IDs
        const insertStmt = writer.prepare(
          `INSERT INTO pinakes_claims (scope, source_uri, topic, claim, extracted_at, version)
           VALUES (?, ?, ?, ?, ?, ?)`,
        );

        // Group new claims by topic for matching
        const newByTopic = new Map<string, Array<{ claim: ExtractedClaim; id: number }>>();
        for (const claim of claims) {
          const key = claim.topic.toLowerCase();

          // Check if there's a matching old claim to get version from
          const oldGroup = oldByTopic.get(key);
          let version = 1;
          if (oldGroup && oldGroup.length > 0) {
            // Take the first available old claim's version + 1
            version = oldGroup[0]!.version + 1;
          }

          const info = insertStmt.run(scope, file.source_uri, claim.topic, claim.claim, now, version);
          const newId = Number(info.lastInsertRowid);

          let list = newByTopic.get(key);
          if (!list) {
            list = [];
            newByTopic.set(key, list);
          }
          list.push({ claim, id: newId });
        }

        // Step 4: Match old→new by topic and supersede
        const supersedStmt = writer.prepare(
          `UPDATE pinakes_claims SET superseded_by = ?, superseded_at = ? WHERE id = ?`,
        );

        const affectedSourceUris = new Set<string>();

        for (const [topicKey, oldGroup] of oldByTopic) {
          const newGroup = newByTopic.get(topicKey);

          if (newGroup && newGroup.length > 0) {
            // Match old claims 1:1 with new claims (FIFO)
            const matchCount = Math.min(oldGroup.length, newGroup.length);
            for (let i = 0; i < matchCount; i++) {
              supersedStmt.run(newGroup[i]!.id, now, oldGroup[i]!.id);
            }
            // Any remaining old claims without a new match are retired
            for (let i = matchCount; i < oldGroup.length; i++) {
              supersedStmt.run(null, now, oldGroup[i]!.id);
            }
            affectedSourceUris.add(file.source_uri);
          } else {
            // Topic removed entirely — retire all old claims
            for (const oc of oldGroup) {
              supersedStmt.run(null, now, oc.id);
            }
            affectedSourceUris.add(file.source_uri);
          }
        }

        // Step 5: Apply confidence adjustments if any supersession happened
        if (affectedSourceUris.size > 0) {
          applySupersessionConfidence(writer, scope, file.source_uri);
        }

        // Step 6: Version chain pruning
        pruneVersionChains(writer, scope, file.source_uri);

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

// ----------------------------------------------------------------------------
// Supersession helpers
// ----------------------------------------------------------------------------

/**
 * Apply confidence penalty to nodes in a file that had claims superseded.
 * The penalty is small (-0.05) since supersession means the info evolved,
 * not necessarily that it was wrong. A boost is applied for the new claims.
 */
function applySupersessionConfidence(
  writer: BetterSqliteDatabase,
  scope: string,
  sourceUri: string,
): void {
  // Penalty on nodes with superseded claims (stale info)
  writer
    .prepare(
      `UPDATE pinakes_nodes SET confidence_score = MAX(0.1, confidence_score - ?)
       WHERE scope = ? AND source_uri = ?`,
    )
    .run(SUPERSESSION_PENALTY, scope, sourceUri);

  // Boost on the same nodes (they now have fresh claims too)
  writer
    .prepare(
      `UPDATE pinakes_nodes SET confidence_score = MIN(1.0, confidence_score + ?)
       WHERE scope = ? AND source_uri = ?`,
    )
    .run(SUPERSESSION_BOOST, scope, sourceUri);
}

/**
 * Prune version chains that exceed MAX_CLAIM_VERSIONS per (scope, source_uri, topic).
 * Keeps the newest MAX_CLAIM_VERSIONS claims, hard-deletes the rest.
 */
export function pruneVersionChains(
  writer: BetterSqliteDatabase,
  scope: string,
  sourceUri: string,
): void {
  // Find topics with too many versions
  const groups = writer
    .prepare<[string, string, number], { topic: string; cnt: number }>(
      `SELECT topic, COUNT(*) as cnt FROM pinakes_claims
       WHERE scope = ? AND source_uri = ?
       GROUP BY LOWER(topic)
       HAVING cnt > ?`,
    )
    .all(scope, sourceUri, MAX_CLAIM_VERSIONS);

  for (const group of groups) {
    // Get oldest claims beyond the limit (ordered by version ASC, skip newest MAX_CLAIM_VERSIONS)
    const toDelete = writer
      .prepare<[string, string, string, number], { id: number }>(
        `SELECT id FROM pinakes_claims
         WHERE scope = ? AND source_uri = ? AND LOWER(topic) = LOWER(?)
         ORDER BY version DESC, id DESC
         LIMIT -1 OFFSET ?`,
      )
      .all(scope, sourceUri, group.topic, MAX_CLAIM_VERSIONS);

    if (toDelete.length > 0) {
      const ids = toDelete.map((r) => r.id);
      const placeholders = ids.map(() => '?').join(',');
      // Clear any superseded_by pointers referencing claims about to be deleted
      writer.prepare(
        `UPDATE pinakes_claims SET superseded_by = NULL WHERE superseded_by IN (${placeholders})`,
      ).run(...ids);
      // Delete the oldest versions
      writer.prepare(
        `DELETE FROM pinakes_claims WHERE id IN (${placeholders})`,
      ).run(...ids);
    }
  }
}

// ----------------------------------------------------------------------------
// Query helpers
// ----------------------------------------------------------------------------

/**
 * Query all active (non-superseded) claims for a scope, optionally filtered by topic.
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
         FROM pinakes_claims WHERE scope = ? AND topic = ? AND superseded_at IS NULL
         ORDER BY source_uri`,
      )
      .all(scope, topic);
  }

  return reader
    .prepare<[string], { id: number; source_uri: string; topic: string; claim: string; extracted_at: number }>(
      `SELECT id, source_uri, topic, claim, extracted_at
       FROM pinakes_claims WHERE scope = ? AND superseded_at IS NULL
       ORDER BY topic, source_uri`,
    )
    .all(scope);
}

/**
 * Return the full version chain for a topic within a scope, ordered by version descending.
 */
export function queryClaimHistory(
  reader: BetterSqliteDatabase,
  scope: string,
  topic: string,
): ClaimVersion[] {
  return reader
    .prepare<[string, string], ClaimVersion>(
      `SELECT id, scope, source_uri, topic, claim, version, extracted_at, superseded_by, superseded_at
       FROM pinakes_claims
       WHERE scope = ? AND LOWER(topic) = LOWER(?)
       ORDER BY version DESC`,
    )
    .all(scope, topic);
}

/**
 * Return claims superseded after a given timestamp.
 * If `since` is omitted, returns all superseded claims.
 */
export function queryRecentlySuperseded(
  reader: BetterSqliteDatabase,
  scope: string,
  since?: number,
): SupersededClaim[] {
  const rows = since != null
    ? reader
        .prepare<[string, number], { id: number; source_uri: string; topic: string; claim: string; version: number; superseded_at: number; superseded_by: number | null }>(
          `SELECT id, source_uri, topic, claim, version, superseded_at, superseded_by
           FROM pinakes_claims
           WHERE scope = ? AND superseded_at IS NOT NULL AND superseded_at > ?
           ORDER BY superseded_at DESC`,
        )
        .all(scope, since)
    : reader
        .prepare<[string], { id: number; source_uri: string; topic: string; claim: string; version: number; superseded_at: number; superseded_by: number | null }>(
          `SELECT id, source_uri, topic, claim, version, superseded_at, superseded_by
           FROM pinakes_claims
           WHERE scope = ? AND superseded_at IS NOT NULL
           ORDER BY superseded_at DESC`,
        )
        .all(scope);

  return rows.map((row) => resolveSupersededClaim(reader, row));
}

function resolveSupersededClaim(
  reader: BetterSqliteDatabase,
  row: { id: number; source_uri: string; topic: string; claim: string; version: number; superseded_at: number; superseded_by: number | null },
): SupersededClaim {
  let newClaim: string | null = null;
  let newVersion: number | null = null;
  if (row.superseded_by != null) {
    const successor = reader
      .prepare<[number], { claim: string; version: number }>(
        `SELECT claim, version FROM pinakes_claims WHERE id = ?`,
      )
      .get(row.superseded_by);
    if (successor) {
      newClaim = successor.claim;
      newVersion = successor.version;
    }
  }
  return {
    id: row.id,
    source_uri: row.source_uri,
    topic: row.topic,
    old_claim: row.claim,
    new_claim: newClaim,
    old_version: row.version,
    new_version: newVersion,
    superseded_at: row.superseded_at,
    superseded_by: row.superseded_by,
  };
}
