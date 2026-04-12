import { existsSync } from 'node:fs';

import { closeDb, openDb } from '../db/client.js';
import { PINAKES_TABLES, PINAKES_VIRTUAL_TABLES } from '../db/schema.js';
import { resolveCliDbPath } from '../paths.js';

/**
 * `pinakes status` — health check for Pinakes Phase 2.
 *
 * Opens the project + personal DBs (if they exist), reports row counts per
 * table, schema version, last full rebuild timestamp, and SQLite version.
 *
 * No DB writes — strictly read-only. Safe to run while a `pinakes serve` instance
 * is also running on the same DB (WAL mode + read connection makes this fine).
 */

export interface StatusOptions {
  /** Project root directory (default: cwd) */
  projectRoot?: string;
  /** Path to project DB override */
  dbPath?: string;
  /** Path to personal DB (default: `~/.pinakes/pinakes.db`) */
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
  const projectDb = resolveCliDbPath(options, 'project');
  const profileDb = resolveCliDbPath(options, 'personal');

  return [
    inspectScope('project', projectDb),
    inspectScope('personal', profileDb),
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
    for (const table of [...PINAKES_TABLES, ...PINAKES_VIRTUAL_TABLES]) {
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
      .prepare("SELECT value FROM pinakes_meta WHERE key = 'schema_version'")
      .get() as { value: string } | undefined;
    status.schemaVersion = schemaRow?.value ?? null;

    const rebuildRow = bundle.writer
      .prepare("SELECT value FROM pinakes_meta WHERE key = 'last_full_rebuild'")
      .get() as { value: string } | undefined;
    status.lastFullRebuild = rebuildRow ? parseInt(rebuildRow.value, 10) : null;

    for (const table of [...PINAKES_TABLES, ...PINAKES_VIRTUAL_TABLES]) {
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

