import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { relative, resolve } from 'node:path';

import { logger } from '../observability/logger.js';
import { loadIgnorePatterns, shouldIgnore } from './ignore.js';

/**
 * Scan a project directory for markdown files to bootstrap `.pinakes/wiki/`,
 * respecting .gitignore and `.pinakesignore`.
 *
 * Primary strategy: `git ls-files` (fast, respects .gitignore).
 * Fallback: recursive walk with hardcoded excludes (non-git repos).
 * Both paths filter results through `.pinakesignore` + built-in defaults.
 *
 * Returns absolute paths, sorted deterministically.
 */
export function scanRepoMarkdownFiles(projectRoot: string): string[] {
  const absRoot = resolve(projectRoot);
  const patterns = loadIgnorePatterns(absRoot);

  let files: string[];
  try {
    files = scanViaGit(absRoot);
  } catch {
    logger.debug({ projectRoot }, 'git ls-files failed, falling back to recursive walk');
    files = scanViaWalk(absRoot);
  }

  // Apply .pinakesignore filtering
  const filtered = files.filter((absPath) => {
    const rel = relative(absRoot, absPath);
    return !shouldIgnore(rel, patterns);
  });

  if (filtered.length < files.length) {
    logger.info(
      { total: files.length, kept: filtered.length, ignored: files.length - filtered.length },
      '.pinakesignore: filtered repo markdown files'
    );
  }

  return filtered;
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

  const wikiDir = resolve(projectRoot, '.pinakes', 'wiki');

  return stdout
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .filter((l) => !l.startsWith('.pinakes/'))
    .map((rel) => resolve(projectRoot, rel))
    // Belt-and-suspenders: reject any file that resolved inside the wiki dir
    .filter((abs) => !abs.startsWith(wikiDir + '/') && abs !== wikiDir)
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

  const wikiDir = resolve(projectRoot, '.pinakes', 'wiki');

  for (const entry of entries) {
    if (WALK_EXCLUDES.has(entry.name)) continue;

    const full = resolve(dir, entry.name);

    // Belt-and-suspenders: never recurse into the wiki directory
    if (full === wikiDir || full.startsWith(wikiDir + '/')) continue;

    if (entry.isDirectory()) {
      walkDir(full, projectRoot, results);
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      results.push(full);
    }
  }
}
