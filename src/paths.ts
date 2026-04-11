/**
 * Centralized path resolution for Pinakes.
 *
 * All Pinakes data lives under a single root directory (~/.pinakes by default).
 * Project data is stored in mirrored paths under ~/.pinakes/projects/, using
 * the Claude Code convention of replacing '/' with '-' in the absolute project
 * path. Personal data lives directly under the root.
 *
 * Layout:
 *   ~/.pinakes/
 *     wiki/                                       # personal wiki
 *     pinakes.db                                  # personal DB
 *     audit.jsonl                                 # personal audit
 *     manifest.json                               # personal manifest
 *     projects/
 *       -Users-sebastian-dev-myproject/            # mangled project root
 *         wiki/                                   # project wiki
 *         pinakes.db                              # project DB
 *         audit.jsonl                             # project audit
 *         manifest.json                           # project manifest
 */

import { homedir } from 'node:os';
import { isAbsolute, resolve } from 'node:path';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Resolve a path to absolute, using cwd if relative. */
export function resolveAbs(p: string): string {
  return isAbsolute(p) ? p : resolve(process.cwd(), p);
}

/**
 * Mangle an absolute path into a directory-safe name.
 * Uses Claude Code's convention: replace '/' with '-'.
 *
 * `/Users/sebastian/dev/myproject` → `-Users-sebastian-dev-myproject`
 */
export function mangleProjectPath(absolutePath: string): string {
  return absolutePath.replace(/\//g, '-');
}

// ---------------------------------------------------------------------------
// Root
// ---------------------------------------------------------------------------

/**
 * Pinakes root directory. All data lives here.
 * Default: `~/.pinakes`
 * Override: `PINAKES_ROOT` env var
 */
export function pinakesRoot(): string {
  const env = process.env.PINAKES_ROOT;
  if (env) return resolveAbs(env);
  return resolve(homedir(), '.pinakes');
}

// ---------------------------------------------------------------------------
// Project paths (derived from project root directory)
// ---------------------------------------------------------------------------

/**
 * The mirrored data directory for a project.
 * e.g. `/Users/me/dev/proj` → `~/.pinakes/projects/-Users-me-dev-proj`
 */
export function projectDataDir(projectRoot: string): string {
  const abs = resolveAbs(projectRoot);
  return resolve(pinakesRoot(), 'projects', mangleProjectPath(abs));
}

export function projectWikiPath(projectRoot: string): string {
  return resolve(projectDataDir(projectRoot), 'wiki');
}

export function projectDbPath(projectRoot: string): string {
  return resolve(projectDataDir(projectRoot), 'pinakes.db');
}

export function projectAuditJsonlPath(projectRoot: string): string {
  return resolve(projectDataDir(projectRoot), 'audit.jsonl');
}

export function projectManifestPath(projectRoot: string): string {
  return resolve(projectDataDir(projectRoot), 'manifest.json');
}

// ---------------------------------------------------------------------------
// Personal paths (directly under pinakes root)
// ---------------------------------------------------------------------------

export function personalWikiPath(): string {
  return resolve(pinakesRoot(), 'wiki');
}

export function personalDbPath(): string {
  return resolve(pinakesRoot(), 'pinakes.db');
}

export function personalAuditJsonlPath(): string {
  return resolve(pinakesRoot(), 'audit.jsonl');
}

export function personalManifestPath(): string {
  return resolve(pinakesRoot(), 'manifest.json');
}

// ---------------------------------------------------------------------------
// CLI helper: resolve DB path from common CLI options
// ---------------------------------------------------------------------------

export interface CliPathOverrides {
  projectRoot?: string;
  dbPath?: string;
  wikiPath?: string;
  profileDbPath?: string;
}

/**
 * Resolve the DB path for a given scope, honoring CLI overrides.
 * Shared by all CLI subcommands (status, audit, export, import, purge, etc.)
 */
export function resolveCliDbPath(
  options: CliPathOverrides,
  scope: 'project' | 'personal'
): string {
  if (scope === 'personal') {
    if (options.profileDbPath) return resolveAbs(options.profileDbPath);
    return personalDbPath();
  }
  if (options.dbPath) return resolveAbs(options.dbPath);
  return projectDbPath(options.projectRoot ?? process.cwd());
}
