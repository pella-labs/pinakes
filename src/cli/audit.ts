import { existsSync } from 'node:fs';

import { closeDb, openDb } from '../db/client.js';
import { resolveCliDbPath } from '../paths.js';

/**
 * `pinakes audit --tail` — tail the pinakes_audit table for a scope's DB.
 *
 * Reads the most recent N audit rows (default 20) and prints them as
 * newline-delimited JSON. Strictly read-only.
 */

export interface AuditOptions {
  /** Number of rows to show (default 20) */
  n?: number;
  /** Project root directory (default: cwd) */
  projectRoot?: string;
  /** Project DB path override */
  dbPath?: string;
  /** Wiki path (unused in new layout, kept for backwards compat) */
  wikiPath?: string;
  /** Personal DB path */
  profileDbPath?: string;
  /** Which scope to tail: 'project' | 'personal' (default 'project') */
  scope?: 'project' | 'personal';
}

export interface AuditRow {
  id: number;
  ts: number;
  tool_name: string;
  scope_requested: string;
  caller_ctx: string | null;
  response_tokens: number | null;
  error: string | null;
}

export function auditCommand(options: AuditOptions): AuditRow[] {
  const scope = options.scope ?? 'project';
  const n = options.n ?? 20;
  const dbPath = resolveCliDbPath(options, scope);

  if (!existsSync(dbPath)) {
    return [];
  }

  const bundle = openDb(dbPath, { runMigrations: false });
  try {
    const rows = bundle.writer
      .prepare(
        `SELECT id, ts, tool_name, scope_requested, caller_ctx, response_tokens, error
         FROM pinakes_audit ORDER BY id DESC LIMIT ?`
      )
      .all(n) as AuditRow[];
    return rows.reverse(); // chronological order
  } finally {
    closeDb(bundle);
  }
}

export function renderAudit(rows: AuditRow[]): string {
  if (rows.length === 0) return '(no audit rows)';
  return rows.map((r) => JSON.stringify(r)).join('\n');
}

