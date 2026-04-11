import type { Database as BetterSqliteDatabase } from 'better-sqlite3';

/**
 * FTS5 full-text search with BM25 ranking and optional snippet extraction.
 *
 * Extracted from `src/sandbox/bindings/pinakes.ts` so both the sandbox bindings
 * and the `pinakes_search` MCP tool can share the same query logic. The binding
 * delegates here; the MCP tool calls `hybridSearch` which calls here.
 *
 * **Tokenizer**: `unicode61 remove_diacritics 2` (set in the migration).
 * **NOT trigram** — it triples the DB size (presearch.md §Loop 0 gotcha).
 *
 * **Query escaping**: each whitespace-separated token is wrapped in double
 * quotes so user/LLM-provided input can't trigger FTS5 syntax errors.
 */

export interface FtsResult {
  id: string;
  text: string;
  snippet: string;
  source_uri: string;
  node_id: string;
  rank: number;
  confidence: string;
  title: string | null;
  section_path: string;
}

/**
 * Run an FTS5 MATCH query with BM25 ranking and snippet extraction.
 *
 * @param reader   A read-only `better-sqlite3` connection (from the read pool).
 * @param scope    `'project'` or `'personal'` — filters by `pinakes_nodes.scope`.
 * @param query    Raw user/LLM query string (will be escaped).
 * @param limit    Max results (clamped to 1..100 by callers).
 * @returns        Results ranked by BM25 (lower rank = better match).
 */
export function ftsQuery(
  reader: BetterSqliteDatabase,
  scope: string,
  query: string,
  limit: number
): FtsResult[] {
  const escaped = escapeFts5Query(query);
  if (!escaped) return [];

  const rows = reader
    .prepare<
      [string, string, number],
      { id: string; text: string; snippet: string; source_uri: string; node_id: string; rank: number; confidence: string; title: string | null; section_path: string }
    >(
      `SELECT c.id AS id, c.text AS text,
              snippet(pinakes_chunks_fts, 0, '', '', '…', 64) AS snippet,
              n.source_uri AS source_uri,
              n.id AS node_id, bm25(pinakes_chunks_fts) AS rank,
              n.confidence AS confidence,
              n.title AS title,
              n.section_path AS section_path
         FROM pinakes_chunks_fts f
         JOIN pinakes_chunks c ON c.rowid = f.rowid
         JOIN pinakes_nodes n ON c.node_id = n.id
        WHERE n.scope = ?
          AND pinakes_chunks_fts MATCH ?
        ORDER BY bm25(pinakes_chunks_fts)
        LIMIT ?`
    )
    .all(scope, escaped, limit);

  return rows;
}

/**
 * Escape an FTS5 query by wrapping each token in double quotes. This prevents
 * FTS5 syntax errors when the query contains special characters (*, +, -, etc).
 * Returns null if no valid tokens remain.
 */
export function escapeFts5Query(query: string): string | null {
  const tokens = query
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
  if (tokens.length === 0) return null;
  return tokens.map((t) => `"${t.replace(/"/g, '""')}"`).join(' ');
}
