import type { Database as BetterSqliteDatabase } from 'better-sqlite3';

import { logger } from '../observability/logger.js';

/**
 * Gap detector for Pinakes Phase 6.
 *
 * After an ingest transaction commits, scans the new node's content for
 * concept mentions. A "concept" is a term referenced via bold (`**term**`),
 * wikilinks (`[[term]]`), or backtick-quoted identifiers that appears ≥3
 * times across the entire KG but has no dedicated `pinakes_nodes` row (i.e., no
 * node whose title matches the concept).
 *
 * Upserts into `pinakes_gaps` with `topic`, `first_seen_at`, `mentions_count`.
 * When a node is later created with a matching title, `resolved_at` is set.
 *
 * This is a read-only detection surface — the LLM fills gaps by calling
 * `pinakes.project.write()` to create wiki pages, and re-indexing resolves
 * the gap automatically.
 */

// ----------------------------------------------------------------------------
// Concept extraction
// ----------------------------------------------------------------------------

/**
 * Extract candidate concept strings from markdown content.
 *
 * Sources:
 * - Bold text: `**term**` or `__term__`
 * - Wikilinks: `[[term]]` or `[[term|display]]`
 * - Backtick-quoted terms: `` `term` `` (single backtick only, not code fences)
 *
 * Returns deduplicated, normalized (lowercase, trimmed) set.
 */
export function extractConcepts(content: string): Set<string> {
  const concepts = new Set<string>();

  // Bold: **term** or __term__
  const boldRe = /\*\*([^*]+)\*\*|__([^_]+)__/g;
  for (const m of content.matchAll(boldRe)) {
    const term = (m[1] ?? m[2] ?? '').trim().toLowerCase();
    if (term.length >= 2 && term.length <= 100) concepts.add(term);
  }

  // Wikilinks: [[term]] or [[term|display]]
  const wikilinkRe = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;
  for (const m of content.matchAll(wikilinkRe)) {
    const term = (m[1] ?? '').trim().toLowerCase();
    if (term.length >= 2 && term.length <= 100) concepts.add(term);
  }

  // Backtick terms (single backtick, not code fences)
  const backtickRe = /(?<!`)(`[^`\n]+?`)(?!`)/g;
  for (const m of content.matchAll(backtickRe)) {
    const raw = m[1] ?? '';
    const term = raw.slice(1, -1).trim().toLowerCase();
    // Only keep multi-char, non-code-looking terms (no spaces in very long strings)
    if (term.length >= 2 && term.length <= 60 && !/[{}();=]/.test(term)) {
      concepts.add(term);
    }
  }

  return concepts;
}

// ----------------------------------------------------------------------------
// Gap detection + resolution
// ----------------------------------------------------------------------------

/**
 * Run gap detection after an ingest transaction commits.
 *
 * For each concept extracted from the ingested content:
 * 1. Count how many chunks across the KG contain the concept (case-insensitive)
 * 2. Check if a node with a matching title already exists
 * 3. If ≥3 mentions and no dedicated node → upsert into `pinakes_gaps`
 *
 * Also resolves any existing gaps that now have a dedicated node.
 *
 * @param writer  The writer DB connection (same transaction context as ingest).
 * @param scope   'project' or 'personal'.
 * @param content The full file content that was just ingested.
 * @param nodesTitles Titles of all nodes that were just ingested (for resolution check).
 */
export function detectGaps(
  writer: BetterSqliteDatabase,
  scope: string,
  content: string,
  nodesTitles: string[]
): { gaps_created: number; gaps_resolved: number } {
  let gapsCreated = 0;
  let gapsResolved = 0;

  // Phase 1: resolve existing gaps whose topics match newly-ingested node titles
  gapsResolved = resolveGaps(writer, scope, nodesTitles);

  // Phase 2: detect new gaps from concepts in the ingested content
  const concepts = extractConcepts(content);

  if (concepts.size === 0) {
    return { gaps_created: gapsCreated, gaps_resolved: gapsResolved };
  }

  const countChunkMentions = writer.prepare<[string, string], { c: number }>(
    `SELECT count(*) AS c FROM pinakes_chunks ch
       JOIN pinakes_nodes n ON ch.node_id = n.id
      WHERE n.scope = ? AND ch.text LIKE '%' || ? || '%' COLLATE NOCASE`
  );

  const findDedicatedNode = writer.prepare<[string, string], { id: string }>(
    `SELECT id FROM pinakes_nodes WHERE scope = ? AND LOWER(title) = ? LIMIT 1`
  );

  // pinakes_gaps doesn't have a unique constraint on (scope, topic).
  // Check if the gap already exists and update or insert accordingly.
  const findGap = writer.prepare<[string, string], { id: number; resolved_at: number | null }>(
    `SELECT id, resolved_at FROM pinakes_gaps WHERE scope = ? AND topic = ? LIMIT 1`
  );

  const insertGap = writer.prepare(
    `INSERT INTO pinakes_gaps (scope, topic, first_seen_at, mentions_count)
     VALUES (?, ?, ?, ?)`
  );

  const updateGapCount = writer.prepare(
    `UPDATE pinakes_gaps SET mentions_count = ?, resolved_at = NULL WHERE id = ?`
  );

  const now = Date.now();

  for (const concept of concepts) {
    // Count mentions across the KG
    const row = countChunkMentions.get(scope, concept);
    const count = row?.c ?? 0;
    if (count < 3) continue;

    // Check for a dedicated node
    const dedicated = findDedicatedNode.get(scope, concept);
    if (dedicated) continue;

    // Upsert the gap
    const existing = findGap.get(scope, concept);
    if (existing) {
      // Update mention count; reopen if previously resolved
      updateGapCount.run(count, existing.id);
    } else {
      insertGap.run(scope, concept, now, count);
      gapsCreated++;
    }
  }

  if (gapsCreated > 0 || gapsResolved > 0) {
    logger.info(
      { scope, gapsCreated, gapsResolved, conceptsScanned: concepts.size },
      'gap detection complete'
    );
  }

  return { gaps_created: gapsCreated, gaps_resolved: gapsResolved };
}

/**
 * Resolve gaps whose topics match any of the given node titles.
 * Sets `resolved_at` to now for matching unresolved gaps.
 */
export function resolveGaps(
  writer: BetterSqliteDatabase,
  scope: string,
  nodesTitles: string[]
): number {
  if (nodesTitles.length === 0) return 0;

  const now = Date.now();
  let resolved = 0;

  const resolveStmt = writer.prepare(
    `UPDATE pinakes_gaps SET resolved_at = ?
      WHERE scope = ? AND LOWER(topic) = ? AND resolved_at IS NULL`
  );

  for (const title of nodesTitles) {
    if (!title) continue;
    const info = resolveStmt.run(now, scope, title.toLowerCase());
    resolved += info.changes;
  }

  return resolved;
}

// ----------------------------------------------------------------------------
// Query helpers (used by the gaps() binding)
// ----------------------------------------------------------------------------

export interface GapRow {
  id: number;
  topic: string;
  first_seen_at: number;
  mentions_count: number;
  resolved_at: number | null;
}

/**
 * Query gaps for a scope. Returns unresolved by default; pass
 * `resolved: true` to include resolved gaps.
 */
export function queryGaps(
  reader: BetterSqliteDatabase,
  scope: string,
  opts?: { resolved?: boolean }
): GapRow[] {
  if (opts?.resolved) {
    return reader
      .prepare<[string], GapRow>(
        `SELECT id, topic, first_seen_at, mentions_count, resolved_at
           FROM pinakes_gaps WHERE scope = ? ORDER BY mentions_count DESC`
      )
      .all(scope);
  }

  return reader
    .prepare<[string], GapRow>(
      `SELECT id, topic, first_seen_at, mentions_count, resolved_at
         FROM pinakes_gaps WHERE scope = ? AND resolved_at IS NULL
         ORDER BY mentions_count DESC`
    )
    .all(scope);
}
