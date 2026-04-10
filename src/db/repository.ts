import type { Database as BetterSqliteDatabase } from 'better-sqlite3';

import type { Chunk } from './types.js';
import { type DbBundle, nextReader } from './client.js';

/**
 * The repository is the seam between the tool handlers and the SQLite
 * storage layer. Phase 1 used an in-memory `MemoryStore` directly; Phase 2
 * swaps in this `Repository` without changing what the tool handlers see.
 *
 * **Method shapes mirror MemoryStore exactly** so the swap in Pass 4 is a
 * one-line rename in each handler. `search()` returns the same `Chunk`
 * shape and the same insertion-order semantics; `get()` returns the same
 * `Chunk | null`.
 *
 * **Query implementation: LIKE, not FTS5.** Phase 2 stops short of the
 * FTS5+RRF query path — that lands in Phase 4. Two reasons:
 *   1. The Phase 1 spike tests use substring queries (e.g. "hashPassword")
 *      and assert ≥1 result; FTS5's tokenizer would split on case
 *      boundaries differently and may break those assertions.
 *   2. The FTS5 virtual table is *populated* in Phase 2 (via the migration's
 *      triggers) so Phase 4 only has to swap the WHERE clause — the data is
 *      already indexed.
 *
 * **Scope routing**: the data plane supports both `project` and `personal`
 * (separate DB bundles, separate manifests). The Phase 5 privacy invariant
 * gate lives in the tool handlers, not here — repository methods accept
 * a scope param and route to the matching bundle. If a personal bundle
 * isn't loaded, personal-scope reads return empty / null. The 15-test
 * privacy adversarial suite is a Phase 5 deliverable; Phase 2 keeps the
 * existing tool-handler gate that rejects personal-scope tool calls.
 *
 * **Single writer / multi reader**: writes go through `bundle.writer`;
 * reads go through round-robin `nextReader(bundle)`. Repository.search/get
 * are read-only and use the read pool.
 */
export class Repository {
  constructor(
    private readonly project: DbBundle,
    private readonly personal: DbBundle | null = null
  ) {}

  /**
   * Resolve the bundle for a given scope. Returns null for `'personal'`
   * if no personal bundle was provided (so callers degrade gracefully).
   * `'both'` is not handled here — callers must split into two calls and
   * tag results with `source_scope` (CLAUDE.md §Security #6).
   */
  private bundleFor(scope: 'project' | 'personal'): DbBundle | null {
    return scope === 'project' ? this.project : this.personal;
  }

  /**
   * Case-insensitive substring search over chunks of the given scope.
   *
   * Phase 1 semantics preserved: returns matches in deterministic
   * insertion order (by source_uri, then chunk_index). The `text LIKE`
   * predicate is case-insensitive in SQLite when both sides are ASCII —
   * to be safe across Unicode, we lowercase the query AND use a `LIKE`
   * with `lower(text)` so the comparison is symmetrical.
   *
   * Empty query returns an empty array (matches MemoryStore behavior).
   *
   * Phase 4 swaps this to FTS5+RRF; the return shape stays identical.
   */
  search(query: string, scope: 'project' | 'personal' = 'project'): Chunk[] {
    const bundle = this.bundleFor(scope);
    if (!bundle) return [];

    const q = query.trim();
    if (!q) return [];

    const reader = nextReader(bundle);
    const rows = reader
      .prepare<[string, string], { id: string; text: string; source_uri: string; chunk_index: number }>(
        `SELECT c.id AS id, c.text AS text, n.source_uri AS source_uri, c.chunk_index AS chunk_index
           FROM kg_chunks c JOIN kg_nodes n ON c.node_id = n.id
          WHERE n.scope = ?
            AND lower(c.text) LIKE '%' || lower(?) || '%'
          ORDER BY n.source_uri, c.chunk_index`
      )
      .all(scope, q);

    // Bump last_accessed_at on hit nodes (Phase 5 LRU groundwork). Best-effort,
    // failures are non-fatal — eviction is a future concern, not a hot path.
    if (rows.length > 0) {
      try {
        this.touchNodesByChunkIds(
          bundle.writer,
          rows.map((r) => r.id)
        );
      } catch {
        /* swallow — tracking-only */
      }
    }

    return rows.map((r) => ({
      id: r.id,
      text: r.text,
      source_uri: r.source_uri,
      chunk_index: r.chunk_index,
    }));
  }

  /**
   * Exact lookup by chunk id. Returns null on miss (matches MemoryStore).
   */
  get(id: string, scope: 'project' | 'personal' = 'project'): Chunk | null {
    const bundle = this.bundleFor(scope);
    if (!bundle) return null;

    const reader = nextReader(bundle);
    const row = reader
      .prepare<[string, string], { id: string; text: string; source_uri: string; chunk_index: number }>(
        `SELECT c.id AS id, c.text AS text, n.source_uri AS source_uri, c.chunk_index AS chunk_index
           FROM kg_chunks c JOIN kg_nodes n ON c.node_id = n.id
          WHERE n.scope = ? AND c.id = ?
          LIMIT 1`
      )
      .get(scope, id);

    if (!row) return null;

    try {
      this.touchNodesByChunkIds(bundle.writer, [row.id]);
    } catch {
      /* swallow */
    }

    return {
      id: row.id,
      text: row.text,
      source_uri: row.source_uri,
      chunk_index: row.chunk_index,
    };
  }

  /**
   * Total number of indexed chunks for a scope (or both if not specified).
   * Used by `kg status` and the spike-equivalent `store.size()` checks.
   */
  size(scope?: 'project' | 'personal'): number {
    if (scope) {
      const bundle = this.bundleFor(scope);
      if (!bundle) return 0;
      return this.countChunks(bundle, scope);
    }
    return (
      this.countChunks(this.project, 'project') +
      (this.personal ? this.countChunks(this.personal, 'personal') : 0)
    );
  }

  /**
   * The wiki root directory this scope's data was loaded from. Used by
   * the CLI status command and Phase 1's `MemoryStore.root()` parity.
   * Pass-through to whatever the caller stamped on the bundle when opening.
   */
  root(scope: 'project' | 'personal' = 'project'): string {
    const bundle = this.bundleFor(scope);
    return bundle?.path ?? '';
  }

  // --------------------------------------------------------------------------
  // Internal helpers
  // --------------------------------------------------------------------------

  private countChunks(bundle: DbBundle, scope: 'project' | 'personal'): number {
    const reader = nextReader(bundle);
    const row = reader
      .prepare<[string], { c: number }>(
        `SELECT count(*) AS c
           FROM kg_chunks ch JOIN kg_nodes n ON ch.node_id = n.id
          WHERE n.scope = ?`
      )
      .get(scope);
    return row?.c ?? 0;
  }

  /**
   * Bump `last_accessed_at` on the parent nodes of the given chunk ids.
   * Single statement, no transaction needed. Phase 5's LRU eviction reads
   * this column; Phase 2 just keeps it warm.
   */
  private touchNodesByChunkIds(writer: BetterSqliteDatabase, chunkIds: string[]): void {
    if (chunkIds.length === 0) return;
    const placeholders = chunkIds.map(() => '?').join(',');
    writer
      .prepare(
        `UPDATE kg_nodes SET last_accessed_at = ?
          WHERE id IN (SELECT node_id FROM kg_chunks WHERE id IN (${placeholders}))`
      )
      .run(Date.now(), ...chunkIds);
  }
}
