import { existsSync, writeFileSync } from 'node:fs';

import { closeDb, openDb } from '../db/client.js';
import { resolveCliDbPath } from '../paths.js';

/**
 * `pinakes export --scope <s> [--out file.json]` — dump a scope's nodes + edges
 * as JSON for backup / migration / debugging.
 *
 * Output format:
 * ```json
 * {
 *   "scope": "project",
 *   "exported_at": "2026-04-09T...",
 *   "nodes": [ ... ],
 *   "edges": [ ... ],
 *   "chunks": [ ... ]
 * }
 * ```
 */

export interface ExportOptions {
  scope: 'project' | 'personal';
  out?: string;
  dbPath?: string;
  profileDbPath?: string;
}

export interface ExportData {
  scope: string;
  exported_at: string;
  nodes: unknown[];
  edges: unknown[];
  chunks: unknown[];
}

export function exportCommand(options: ExportOptions): ExportData {
  const dbPath = resolveCliDbPath(options, options.scope);

  if (!existsSync(dbPath)) {
    return {
      scope: options.scope,
      exported_at: new Date().toISOString(),
      nodes: [],
      edges: [],
      chunks: [],
    };
  }

  const bundle = openDb(dbPath, { runMigrations: false });
  try {
    const nodes = bundle.writer
      .prepare(`SELECT * FROM pinakes_nodes WHERE scope = ?`)
      .all(options.scope);
    const edges = bundle.writer
      .prepare(
        `SELECT e.* FROM pinakes_edges e
         JOIN pinakes_nodes n ON e.src_id = n.id
         WHERE n.scope = ?`
      )
      .all(options.scope);
    const chunks = bundle.writer
      .prepare(
        `SELECT c.* FROM pinakes_chunks c
         JOIN pinakes_nodes n ON c.node_id = n.id
         WHERE n.scope = ?`
      )
      .all(options.scope);

    const data: ExportData = {
      scope: options.scope,
      exported_at: new Date().toISOString(),
      nodes,
      edges,
      chunks,
    };

    if (options.out) {
      writeFileSync(options.out, JSON.stringify(data, null, 2), 'utf-8');
    }

    return data;
  } finally {
    closeDb(bundle);
  }
}

export function renderExport(data: ExportData, outPath?: string): string {
  const line = `${data.scope}: ${(data.nodes as unknown[]).length} nodes, ${(data.edges as unknown[]).length} edges, ${(data.chunks as unknown[]).length} chunks`;
  if (outPath) return `${line} → ${outPath}`;
  return line;
}

