import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, resolve } from 'node:path';

import { closeDb, openDb } from '../db/client.js';

/**
 * `kg audit --tail` — tail the kg_audit table for a scope's DB.
 *
 * Reads the most recent N audit rows (default 20) and prints them as
 * newline-delimited JSON. Strictly read-only.
 */

export interface AuditOptions {
  /** Number of rows to show (default 20) */
  n?: number;
  /** Project DB path */
  dbPath?: string;
  /** Wiki path (used to derive default dbPath) */
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
  const dbPath = resolveDbPath(options, scope);

  if (!existsSync(dbPath)) {
    return [];
  }

  const bundle = openDb(dbPath, { runMigrations: false });
  try {
    const rows = bundle.writer
      .prepare(
        `SELECT id, ts, tool_name, scope_requested, caller_ctx, response_tokens, error
         FROM kg_audit ORDER BY id DESC LIMIT ?`
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

// ----------------------------------------------------------------------------
// Path helpers (shared pattern with status.ts)
// ----------------------------------------------------------------------------

function resolveDbPath(options: AuditOptions, scope: 'project' | 'personal'): string {
  if (scope === 'personal') {
    if (options.profileDbPath) return resolveAbs(options.profileDbPath);
    const env = process.env.KG_PROFILE_PATH;
    const profileDir = env ? resolveAbs(env) : resolve(homedir(), '.pharos/profile');
    return resolve(profileDir, 'kg.db');
  }
  if (options.dbPath) return resolveAbs(options.dbPath);
  if (options.wikiPath) return resolve(dirname(resolveAbs(options.wikiPath)), 'kg.db');
  return resolve(process.cwd(), '.pharos/kg.db');
}

function resolveAbs(p: string): string {
  return isAbsolute(p) ? p : resolve(process.cwd(), p);
}
