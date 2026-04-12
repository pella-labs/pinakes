import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';

import { logger } from '../observability/logger.js';

/**
 * Scan a project directory for markdown files, respecting .gitignore.
 *
 * Primary strategy: `git ls-files` (fast, respects .gitignore).
 * Fallback: recursive walk with hardcoded excludes (non-git repos).
 *
 * Returns absolute paths, sorted deterministically.
 */
export function scanRepoMarkdownFiles(projectRoot: string): string[] {
  try {
    return scanViaGit(projectRoot);
  } catch {
    logger.debug({ projectRoot }, 'git ls-files failed, falling back to recursive walk');
    return scanViaWalk(projectRoot);
  }
}

// ---------------------------------------------------------------------------
// Git-based scan
// ---------------------------------------------------------------------------

function scanViaGit(projectRoot: string): string[] {
  const stdout = execFileSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', '--', '*.md'],
    { cwd: projectRoot, encoding: 'utf-8', timeout: 10_000, maxBuffer: 4 * 1024 * 1024 }
  );

  return stdout
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .filter((l) => !l.startsWith('.pinakes/'))
    .map((rel) => resolve(projectRoot, rel))
    .sort();
}

// ---------------------------------------------------------------------------
// Fallback recursive walk
// ---------------------------------------------------------------------------

const WALK_EXCLUDES = new Set([
  '.git',
  '.pinakes',
  'node_modules',
  'dist',
  'build',
  'coverage',
  '.next',
  '.nuxt',
  'vendor',
  '__pycache__',
  '.tox',
  'target',
]);

function scanViaWalk(projectRoot: string): string[] {
  const results: string[] = [];
  walkDir(projectRoot, projectRoot, results);
  return results.sort();
}

function walkDir(dir: string, projectRoot: string, results: string[]): void {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return; // permission denied, symlink loop, etc.
  }

  for (const entry of entries) {
    if (WALK_EXCLUDES.has(entry.name)) continue;

    const full = resolve(dir, entry.name);

    if (entry.isDirectory()) {
      walkDir(full, projectRoot, results);
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      results.push(full);
    }
  }
}
