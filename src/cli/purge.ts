import { existsSync, unlinkSync } from 'node:fs';
import { resolveCliDbPath } from '../paths.js';

/**
 * `pinakes purge --scope <s> [--confirm]` — delete a scope's SQLite DB file.
 *
 * This is the nuclear option: wipes the DB entirely. The user can rebuild
 * from markdown afterwards (`pinakes rebuild`). Requires `--confirm` flag to
 * prevent accidental deletion.
 */

export interface PurgeOptions {
  scope: 'project' | 'personal';
  confirm?: boolean;
  dbPath?: string;
  profileDbPath?: string;
}

export interface PurgeResult {
  scope: string;
  dbPath: string;
  deleted: boolean;
  reason?: string;
}

export function purgeCommand(options: PurgeOptions): PurgeResult {
  const dbPath = resolveCliDbPath(options, options.scope);

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

