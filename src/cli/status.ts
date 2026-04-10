import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, resolve } from 'node:path';

import { closeDb, openDb } from '../db/client.js';
import { KG_TABLES, KG_VIRTUAL_TABLES } from '../db/schema.js';

/**
 * `kg status` — health check for KG-MCP Phase 2.
 *
 * Opens the project + personal DBs (if they exist), reports row counts per
 * table, schema version, last full rebuild timestamp, and SQLite version.
 *
 * No DB writes — strictly read-only. Safe to run while a `kg serve` instance
 * is also running on the same DB (WAL mode + read connection makes this fine).
 */

export interface StatusOptions {
  /** Path to project DB. If omitted, defaults to `.pharos/kg.db` from wikiPath if given. */
  dbPath?: string;
  /** Path to project wiki dir, used to derive default dbPath if dbPath omitted */
  wikiPath?: string;
  /** Path to personal DB (default: `~/.pharos/profile/kg.db`) */
  profileDbPath?: string;
}

export interface ScopeStatus {
  scope: 'project' | 'personal';
  dbPath: string;
  exists: boolean;
  schemaVersion: string | null;
  lastFullRebuild: number | null;
  sqliteVersion: string | null;
  rowCounts: Record<string, number>;
}

/**
 * Build a status report for both scopes. The result is a structured object
 * suitable for both human-readable rendering and JSON output (e.g.
 * `kg status --json`).
 */
export function statusCommand(options: StatusOptions = {}): ScopeStatus[] {
  const projectDbPath = resolveProjectDb(options);
  const profileDbPath = resolveProfileDb(options);

  return [
    inspectScope('project', projectDbPath),
    inspectScope('personal', profileDbPath),
  ];
}

/**
 * Pretty-print a list of `ScopeStatus` to a string. Used by the CLI entry to
 * write to stdout. Tests assert against the structured `statusCommand` result
 * directly, not the rendered string.
 */
export function renderStatus(statuses: ScopeStatus[]): string {
  const lines: string[] = [];
  for (const s of statuses) {
    lines.push(`${s.scope.toUpperCase()} DB: ${s.dbPath}`);
    if (!s.exists) {
      lines.push('  (not initialized)');
      lines.push('');
      continue;
    }
    lines.push(`  sqlite_version: ${s.sqliteVersion ?? '<unknown>'}`);
    lines.push(`  schema_version: ${s.schemaVersion ?? '<absent>'}`);
    lines.push(
      `  last_full_rebuild: ${s.lastFullRebuild ? new Date(s.lastFullRebuild).toISOString() : '<never>'}`
    );
    for (const table of [...KG_TABLES, ...KG_VIRTUAL_TABLES]) {
      const count = s.rowCounts[table] ?? 0;
      lines.push(`  ${table.padEnd(20)} ${count}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

// ----------------------------------------------------------------------------
// Internals
// ----------------------------------------------------------------------------

function inspectScope(scope: 'project' | 'personal', dbPath: string): ScopeStatus {
  const status: ScopeStatus = {
    scope,
    dbPath,
    exists: existsSync(dbPath),
    schemaVersion: null,
    lastFullRebuild: null,
    sqliteVersion: null,
    rowCounts: {},
  };

  if (!status.exists) return status;

  // Open with `runMigrations: false` to avoid surprising the user with a
  // schema upgrade just from running `status`. If the schema is out of
  // date, the row counts will still be readable for the tables that exist.
  const bundle = openDb(dbPath, { runMigrations: false });
  try {
    status.sqliteVersion = (bundle.writer.prepare('SELECT sqlite_version() AS v').get() as {
      v: string;
    }).v;

    const schemaRow = bundle.writer
      .prepare("SELECT value FROM kg_meta WHERE key = 'schema_version'")
      .get() as { value: string } | undefined;
    status.schemaVersion = schemaRow?.value ?? null;

    const rebuildRow = bundle.writer
      .prepare("SELECT value FROM kg_meta WHERE key = 'last_full_rebuild'")
      .get() as { value: string } | undefined;
    status.lastFullRebuild = rebuildRow ? parseInt(rebuildRow.value, 10) : null;

    for (const table of [...KG_TABLES, ...KG_VIRTUAL_TABLES]) {
      try {
        const row = bundle.writer.prepare(`SELECT count(*) AS c FROM ${table}`).get() as {
          c: number;
        };
        status.rowCounts[table] = row.c;
      } catch {
        // Table may not exist on an old schema; report 0 and move on.
        status.rowCounts[table] = 0;
      }
    }
  } finally {
    closeDb(bundle);
  }

  return status;
}

function resolveProjectDb(options: StatusOptions): string {
  if (options.dbPath) return resolveAbs(options.dbPath);
  if (options.wikiPath) {
    return resolve(dirname(resolveAbs(options.wikiPath)), 'kg.db');
  }
  // Last resort: ./.pharos/kg.db relative to cwd
  return resolve(process.cwd(), '.pharos/kg.db');
}

function resolveProfileDb(options: StatusOptions): string {
  if (options.profileDbPath) return resolveAbs(options.profileDbPath);
  const env = process.env.KG_PROFILE_PATH;
  const profileDir = env ? resolveAbs(env) : resolve(homedir(), '.pharos/profile');
  return resolve(profileDir, 'kg.db');
}

function resolveAbs(p: string): string {
  return isAbsolute(p) ? p : resolve(process.cwd(), p);
}
