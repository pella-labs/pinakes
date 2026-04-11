import { existsSync, readFileSync } from 'node:fs';

import { closeDb, openDb } from '../db/client.js';
import { logger } from '../observability/logger.js';
import { resolveCliDbPath } from '../paths.js';

/**
 * `pinakes import --scope <s> --in file.json` — restore nodes, edges, and chunks
 * from a JSON dump produced by `pinakes export`.
 *
 * Imports are additive: existing rows with the same PK are replaced via
 * INSERT OR REPLACE. This makes import idempotent — running it twice
 * with the same file produces the same DB state.
 */

export interface ImportOptions {
  scope: 'project' | 'personal';
  inFile: string;
  dbPath?: string;
  wikiPath?: string;
  profileDbPath?: string;
}

export interface ImportResult {
  scope: string;
  nodes: number;
  edges: number;
  chunks: number;
}

interface ExportRow {
  [key: string]: unknown;
}

interface ExportData {
  scope: string;
  nodes: ExportRow[];
  edges: ExportRow[];
  chunks: ExportRow[];
}

export function importCommand(options: ImportOptions): ImportResult {
  if (!existsSync(options.inFile)) {
    throw new Error(`input file does not exist: ${options.inFile}`);
  }

  const raw = readFileSync(options.inFile, 'utf-8');
  const data = JSON.parse(raw) as ExportData;

  if (data.scope && data.scope !== options.scope) {
    logger.warn(
      { fileScope: data.scope, requestedScope: options.scope },
      'import file scope does not match requested scope'
    );
  }

  const dbPath = resolveCliDbPath(options, options.scope);
  const bundle = openDb(dbPath);
  try {
    const result: ImportResult = { scope: options.scope, nodes: 0, edges: 0, chunks: 0 };

    bundle.writer.exec('BEGIN');
    try {
      // Import nodes
      if (data.nodes?.length) {
        const insertNode = bundle.writer.prepare(
          `INSERT OR REPLACE INTO pinakes_nodes
           (id, scope, source_uri, section_path, kind, title, content, source_sha, token_count, confidence, created_at, updated_at, last_accessed_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        );
        for (const n of data.nodes) {
          insertNode.run(
            n.id, options.scope, n.source_uri, n.section_path, n.kind ?? 'section',
            n.title ?? null, n.content, n.source_sha, n.token_count ?? 0,
            n.confidence ?? 'extracted', n.created_at ?? Date.now(),
            n.updated_at ?? Date.now(), n.last_accessed_at ?? Date.now()
          );
          result.nodes++;
        }
      }

      // Import edges
      if (data.edges?.length) {
        const insertEdge = bundle.writer.prepare(
          `INSERT OR REPLACE INTO pinakes_edges (src_id, dst_id, edge_kind)
           VALUES (?, ?, ?)`
        );
        for (const e of data.edges) {
          try {
            insertEdge.run(e.src_id, e.dst_id, e.edge_kind);
            result.edges++;
          } catch (err) {
            // FK violations expected if referenced nodes aren't in the dump
            logger.debug({ err, edge: e }, 'import: skipped edge (FK violation)');
          }
        }
      }

      // Import chunks
      if (data.chunks?.length) {
        const insertChunk = bundle.writer.prepare(
          `INSERT OR REPLACE INTO pinakes_chunks
           (id, node_id, chunk_index, text, chunk_sha, token_count, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        );
        for (const c of data.chunks) {
          try {
            insertChunk.run(
              c.id, c.node_id, c.chunk_index, c.text,
              c.chunk_sha, c.token_count ?? 0, c.created_at ?? Date.now()
            );
            result.chunks++;
          } catch (err) {
            logger.debug({ err, chunk: c }, 'import: skipped chunk (FK violation)');
          }
        }
      }

      bundle.writer.exec('COMMIT');
    } catch (err) {
      bundle.writer.exec('ROLLBACK');
      throw err;
    }

    return result;
  } finally {
    closeDb(bundle);
  }
}

export function renderImport(result: ImportResult): string {
  return `${result.scope}: imported ${result.nodes} nodes, ${result.edges} edges, ${result.chunks} chunks`;
}

