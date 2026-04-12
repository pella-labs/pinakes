/**
 * Centralized path resolution for Pinakes.
 *
 * Project wiki lives in-repo at `<projectRoot>/.pinakes/wiki/` (committed to
 * git, team-shared). Index files (DB, manifest, audit) live under the
 * centralized `~/.pinakes/projects/<mangled>/` directory (not committed).
 * Personal data lives directly under `~/.pinakes/`.
 *
 * Layout:
 *   <projectRoot>/.pinakes/
 *     wiki/                                       # project wiki (committed)
 *     .gitignore                                  # auto-generated (committed)
 *
 *   ~/.pinakes/
 *     wiki/                                       # personal wiki
 *     pinakes.db                                  # personal DB
 *     audit.jsonl                                 # personal audit
 *     manifest.json                               # personal manifest
 *     projects/
 *       -Users-sebastian-dev-myproject/            # mangled project root
 *         pinakes.db                              # project DB
 *         audit.jsonl                             # project audit
 *         manifest.json                           # project manifest
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
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
  return resolve(resolveAbs(projectRoot), '.pinakes', 'wiki');
}

/**
 * Legacy wiki path (pre-v0.3): `~/.pinakes/projects/<mangled>/wiki/`.
 * Used only by the migration function in serve.ts.
 */
export function legacyProjectWikiPath(projectRoot: string): string {
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
  profileDbPath?: string;
}

// ---------------------------------------------------------------------------
// .gitignore auto-generation
// ---------------------------------------------------------------------------

const PINAKES_GITIGNORE_CONTENT = `# Pinakes index files — NOT committed to git
# The wiki/ directory IS committed (shared team knowledge)
pinakes.db
manifest.json
audit.jsonl
*.db-wal
*.db-shm
`;

/**
 * Ensure `<projectRoot>/.pinakes/.gitignore` exists so the DB, manifest, and
 * audit files are never accidentally committed. Idempotent — skips if file
 * already exists.
 */
export function ensurePinakesGitignore(projectRoot: string): void {
  const pinakesDir = resolve(resolveAbs(projectRoot), '.pinakes');
  const gitignorePath = resolve(pinakesDir, '.gitignore');
  if (existsSync(gitignorePath)) return;
  mkdirSync(pinakesDir, { recursive: true });
  writeFileSync(gitignorePath, PINAKES_GITIGNORE_CONTENT, 'utf-8');
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
