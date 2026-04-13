/**
 * Confidence scoring with time decay, corroboration boost, and contradiction penalty.
 *
 * Phase 11.1 — presearch D50, D53, D54.
 *
 * The base `confidence_score` is stored in the DB. The `effectiveConfidence`
 * is computed at query time by applying half-life decay based on how long
 * ago the node was last updated. This avoids background jobs to update
 * scores — the computation is ~0.1ms per result in JS.
 */

import type { Database as BetterSqliteDatabase } from 'better-sqlite3';

// ---------------------------------------------------------------------------
// Half-life configuration per node kind (D53)
// ---------------------------------------------------------------------------

/**
 * Half-life in days by node kind. After `halfLife` days without update,
 * the effective confidence drops to 50% of the base score.
 */
export const HALF_LIFE_DAYS: Record<string, number> = {
  section: 90,
  decision: 180,
  log_entry: 30,
  gap: 60,
  entity: 120,
};

const DEFAULT_HALF_LIFE = 90;
const MS_PER_DAY = 86_400_000;

/**
 * Get the half-life for a given node kind, respecting env var override.
 */
export function getHalfLife(kind: string): number {
  const envOverride = process.env.PINAKES_DECAY_HALF_LIFE_DEFAULT;
  if (envOverride) {
    const parsed = parseInt(envOverride, 10);
    if (!Number.isNaN(parsed) && parsed > 0) return parsed;
  }
  return HALF_LIFE_DAYS[kind] ?? DEFAULT_HALF_LIFE;
}

// ---------------------------------------------------------------------------
// Core confidence functions
// ---------------------------------------------------------------------------

/**
 * Compute effective confidence with exponential decay.
 *
 * Formula: `baseScore * 0.5^(daysSinceUpdate / halfLife)`
 *
 * A node with baseScore=0.7, kind='section' (halfLife=90), updated 90 days ago
 * → effectiveConfidence = 0.7 * 0.5 = 0.35
 */
export function effectiveConfidence(
  baseScore: number,
  updatedAtMs: number,
  kind: string,
  nowMs: number = Date.now(),
): number {
  const daysSinceUpdate = Math.max(0, (nowMs - updatedAtMs) / MS_PER_DAY);
  const halfLife = getHalfLife(kind);
  return baseScore * Math.pow(0.5, daysSinceUpdate / halfLife);
}

/**
 * Boost confidence when multiple sources corroborate the same information.
 * +0.1 per additional source, capped at 1.0.
 */
export function corroborationBoost(currentScore: number, additionalSources: number): number {
  return Math.min(1.0, currentScore + additionalSources * 0.1);
}

/**
 * Penalize confidence when active contradictions exist.
 * -0.15 per active contradiction, floored at 0.1.
 */
export function contradictionPenalty(currentScore: number, activeContradictions: number): number {
  return Math.max(0.1, currentScore - activeContradictions * 0.15);
}

// ---------------------------------------------------------------------------
// Supersession confidence adjustments (D54)
// ---------------------------------------------------------------------------

/** Small penalty for nodes with superseded (stale) claims */
export const SUPERSESSION_PENALTY = 0.05;
/** Small boost for nodes with fresh claims that replace old ones */
export const SUPERSESSION_BOOST = 0.05;

// ---------------------------------------------------------------------------
// Background corroboration scoring
// ---------------------------------------------------------------------------

/**
 * Update corroboration-based confidence scores for all nodes in a scope.
 * For each node, count distinct source_uris in pinakes_claims that have
 * claims matching the node's title, then apply corroborationBoost.
 *
 * Called from extractAllClaims() after claim extraction completes.
 */
export function updateCorroborationScores(
  writer: BetterSqliteDatabase,
  scope: string,
): { updated: number } {
  // Find nodes that are mentioned in claims from multiple source files
  const rows = writer
    .prepare<[string, string], { node_id: string; base_score: number; source_count: number }>(
      `SELECT n.id AS node_id, n.confidence_score AS base_score,
              COUNT(DISTINCT c.source_uri) AS source_count
       FROM pinakes_nodes n
       JOIN pinakes_claims c ON c.scope = ? AND c.topic = n.title COLLATE NOCASE
       WHERE n.scope = ?
       GROUP BY n.id
       HAVING source_count > 1`,
    )
    .all(scope, scope);

  const update = writer.prepare(
    `UPDATE pinakes_nodes SET confidence_score = ? WHERE id = ?`,
  );

  let updated = 0;
  for (const row of rows) {
    // additionalSources = sources beyond the first
    const boosted = corroborationBoost(row.base_score, row.source_count - 1);
    if (boosted !== row.base_score) {
      update.run(boosted, row.node_id);
      updated++;
    }
  }
  return { updated };
}

// ---------------------------------------------------------------------------
// Contradiction penalty application
// ---------------------------------------------------------------------------

export interface ContradictionRef {
  topic: string;
  claimA: { source_uri: string };
  claimB: { source_uri: string };
}

/**
 * Apply confidence penalties to nodes involved in contradictions.
 * For each contradiction, find nodes in the referenced source files
 * and reduce their confidence_score.
 */
export function applyContradictionPenalties(
  writer: BetterSqliteDatabase,
  scope: string,
  contradictions: ContradictionRef[],
): { penalized: number } {
  if (contradictions.length === 0) return { penalized: 0 };

  // Group contradictions by source_uri
  const contradictionsByUri = new Map<string, number>();
  for (const c of contradictions) {
    contradictionsByUri.set(
      c.claimA.source_uri,
      (contradictionsByUri.get(c.claimA.source_uri) ?? 0) + 1,
    );
    contradictionsByUri.set(
      c.claimB.source_uri,
      (contradictionsByUri.get(c.claimB.source_uri) ?? 0) + 1,
    );
  }

  const update = writer.prepare(
    `UPDATE pinakes_nodes SET confidence_score = ? WHERE id = ?`,
  );

  let penalized = 0;
  for (const [uri, count] of contradictionsByUri) {
    const nodes = writer
      .prepare<[string, string], { id: string; confidence_score: number }>(
        `SELECT id, confidence_score FROM pinakes_nodes WHERE scope = ? AND source_uri = ?`,
      )
      .all(scope, uri);

    for (const node of nodes) {
      const newScore = contradictionPenalty(node.confidence_score, count);
      if (newScore !== node.confidence_score) {
        update.run(newScore, node.id);
        penalized++;
      }
    }
  }
  return { penalized };
}

// ---------------------------------------------------------------------------
// Confidence-weighted personal KG eviction
// ---------------------------------------------------------------------------

/**
 * Evict lowest-confidence personal nodes until chunk count is under maxChunks.
 * Replaces pure LRU eviction (D50).
 *
 * Computes effective_confidence in JS (can't do exp() in SQLite), sorts
 * ascending, and deletes the lowest-scoring nodes. CASCADE handles chunks/edges.
 */
export function evictPersonalKg(
  writer: BetterSqliteDatabase,
  maxChunks: number,
  nowMs: number = Date.now(),
): { nodesEvicted: number; chunksEvicted: number } {
  // Count current chunks
  const countRow = writer
    .prepare<[], { cnt: number }>(
      `SELECT COUNT(*) AS cnt FROM pinakes_chunks ch
       JOIN pinakes_nodes n ON ch.node_id = n.id
       WHERE n.scope = 'personal'`,
    )
    .get();
  const currentCount = countRow?.cnt ?? 0;

  if (currentCount <= maxChunks) {
    return { nodesEvicted: 0, chunksEvicted: 0 };
  }

  // Load all personal nodes with their chunk counts
  const nodes = writer
    .prepare<[], { id: string; confidence_score: number; updated_at: number; kind: string; chunk_count: number }>(
      `SELECT n.id, n.confidence_score, n.updated_at, n.kind,
              COUNT(ch.id) AS chunk_count
       FROM pinakes_nodes n
       JOIN pinakes_chunks ch ON ch.node_id = n.id
       WHERE n.scope = 'personal'
       GROUP BY n.id`,
    )
    .all();

  // Compute effective confidence and sort ascending (lowest first)
  const scored = nodes.map((n) => ({
    ...n,
    effective: effectiveConfidence(n.confidence_score, n.updated_at, n.kind, nowMs),
  }));
  scored.sort((a, b) => a.effective - b.effective);

  // Evict until under cap
  let toEvict = currentCount - maxChunks;
  let nodesEvicted = 0;
  let chunksEvicted = 0;

  const deleteNode = writer.prepare(`DELETE FROM pinakes_nodes WHERE id = ?`);

  for (const node of scored) {
    if (toEvict <= 0) break;
    deleteNode.run(node.id);
    toEvict -= node.chunk_count;
    chunksEvicted += node.chunk_count;
    nodesEvicted++;
  }

  return { nodesEvicted, chunksEvicted };
}
