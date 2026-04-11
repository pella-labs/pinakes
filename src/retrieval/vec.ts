import type { Database as BetterSqliteDatabase } from 'better-sqlite3';

import type { Embedder } from './embedder.js';

/**
 * Vector similarity search via sqlite-vec's `vec0` virtual table.
 *
 * The query embedding is computed on the fly by the caller-provided embedder.
 * The sqlite-vec `MATCH` operator performs an approximate nearest-neighbor
 * search against `pinakes_chunks_vec`, returning rowids + cosine distances.
 * We join back to `pinakes_chunks` + `pinakes_nodes` for the full result shape.
 *
 * **Graceful degradation**: if the vec table is empty or the embedder fails,
 * returns an empty array (never throws on query path).
 */

export interface VecResult {
  id: string;
  text: string;
  source_uri: string;
  node_id: string;
  distance: number;
  confidence: string;
  title: string | null;
  section_path: string;
}

/**
 * Run a vector similarity search.
 *
 * @param reader    A read-only `better-sqlite3` connection.
 * @param scope     `'project'` or `'personal'`.
 * @param embedding Pre-computed query embedding (Float32Array of length `dim`).
 * @param limit     Max results (clamped by callers).
 * @returns         Results sorted by ascending distance (closest first).
 */
export function vecQuery(
  reader: BetterSqliteDatabase,
  scope: string,
  embedding: Float32Array,
  limit: number
): VecResult[] {
  try {
    // sqlite-vec expects the embedding as a raw buffer of float32 values.
    const buf = Buffer.from(embedding.buffer, embedding.byteOffset, embedding.byteLength);

    const rows = reader
      .prepare<
        [Buffer, number, string],
        { id: string; text: string; source_uri: string; node_id: string; distance: number; confidence: string; title: string | null; section_path: string }
      >(
        `SELECT c.id AS id, c.text AS text,
                n.source_uri AS source_uri,
                n.id AS node_id,
                v.distance AS distance,
                n.confidence AS confidence,
                n.title AS title,
                n.section_path AS section_path
           FROM pinakes_chunks_vec v
           JOIN pinakes_chunks c ON c.rowid = v.rowid
           JOIN pinakes_nodes n ON c.node_id = n.id
          WHERE v.embedding MATCH ?
            AND k = ?
            AND n.scope = ?
          ORDER BY v.distance`
      )
      .all(buf, limit, scope);

    return rows;
  } catch {
    // Graceful degradation: empty vec table, extension not loaded, etc.
    return [];
  }
}

/**
 * Convenience wrapper: embed the query text, then run vecQuery.
 * Returns [] if the embedder fails (non-fatal on query path).
 */
export async function vecSearch(
  reader: BetterSqliteDatabase,
  scope: string,
  query: string,
  embedder: Embedder,
  limit: number
): Promise<VecResult[]> {
  try {
    const embedding = await embedder.embed(query);
    return vecQuery(reader, scope, embedding, limit);
  } catch {
    return [];
  }
}
