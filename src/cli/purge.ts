import { existsSync, unlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, resolve } from 'node:path';

/**
 * `kg purge --scope <s> [--confirm]` — delete a scope's SQLite DB file.
 *
 * This is the nuclear option: wipes the DB entirely. The user can rebuild
 * from markdown afterwards (`kg rebuild`). Requires `--confirm` flag to
 * prevent accidental deletion.
 */

export interface PurgeOptions {
  scope: 'project' | 'personal';
  confirm?: boolean;
  dbPath?: string;
  wikiPath?: string;
  profileDbPath?: string;
}

export interface PurgeResult {
  scope: string;
  dbPath: string;
  deleted: boolean;
  reason?: string;
}

export function purgeCommand(options: PurgeOptions): PurgeResult {
  const dbPath = resolveDbPath(options, options.scope);

  if (!options.confirm) {
    return {
      scope: options.scope,
      dbPath,
      deleted: false,
      reason: 'pass --confirm to actually delete the database',
    };
  }

  if (!existsSync(dbPath)) {
    return {
      scope: options.scope,
      dbPath,
      deleted: false,
      reason: 'database file does not exist',
    };
  }

  // Remove the main DB file and WAL/SHM sidecars if present
  unlinkSync(dbPath);
  for (const suffix of ['-wal', '-shm']) {
    const sidecar = dbPath + suffix;
    if (existsSync(sidecar)) unlinkSync(sidecar);
  }

  return { scope: options.scope, dbPath, deleted: true };
}

export function renderPurge(result: PurgeResult): string {
  if (result.deleted) {
    return `purged ${result.scope} DB: ${result.dbPath}`;
  }
  return `${result.scope} DB NOT deleted: ${result.reason} (${result.dbPath})`;
}

// ----------------------------------------------------------------------------
// Path helpers
// ----------------------------------------------------------------------------

function resolveDbPath(options: PurgeOptions, scope: 'project' | 'personal'): string {
  if (scope === 'personal') {
    if (options.profileDbPath) return resolveAbs(options.profileDbPath);
    const env = process.env.KG_PROFILE_PATH;
    const profileDir = env ? resolveAbs(env) : resolve(homedir(), '.pharos/profile');
    return resolve(profileDir, 'kg.db');
  }
  if (options.dbPath) return resolveAbs(options.dbPath);
  if (options.wikiPath) return resolve(dirname(resolveAbs(options.wikiPath)), '.pinakes', 'pinakes.db');
  return resolve(process.cwd(), '.pinakes', 'pinakes.db');
}

function resolveAbs(p: string): string {
  return isAbsolute(p) ? p : resolve(process.cwd(), p);
}
