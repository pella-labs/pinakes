import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { basename, dirname, relative, resolve } from 'node:path';

import { logger } from '../observability/logger.js';

export interface StrayReport {
  strayPath: string;
  filesRecovered: string[];
  filesSkipped: string[];
  removed: boolean;
}

export interface ReconcileResult {
  strays: StrayReport[];
}

const SKIP_DIRS = new Set([
  'node_modules',
  'target',
  'dist',
  'build',
  '.git',
  '.pnpm',
  '.venv',
  'venv',
  '.next',
  '.turbo',
  '.cache',
  'coverage',
  'vendor',
]);

const MAX_DEPTH = 8;

/**
 * Walk the project tree looking for accidental `.pinakes/` directories in
 * subdirectories. These happen when an MCP client launches pinakes with cwd
 * set to a subdir (and no absolute `--project-root`), so the server bootstraps
 * a second wiki in the wrong place.
 *
 * For each stray found:
 *   - If its `wiki/` has any markdown, copy the files into
 *     `<canonicalWiki>/recovered/<relative-path-to-stray>/...`, never
 *     overwriting existing files.
 *   - Delete the stray `.pinakes/` directory entirely.
 *
 * Subdirectories that contain their own `.git` are skipped (they are
 * standalone subprojects — their `.pinakes/` is legitimate).
 */
export function reconcileStrayPinakesDirs(
  projectRoot: string,
  canonicalWiki: string,
): ReconcileResult {
  const result: ReconcileResult = { strays: [] };
  const canonicalPinakes = resolve(projectRoot, '.pinakes');

  walk(projectRoot, projectRoot, canonicalPinakes, canonicalWiki, 0, result);

  return result;
}

function walk(
  projectRoot: string,
  current: string,
  canonicalPinakes: string,
  canonicalWiki: string,
  depth: number,
  result: ReconcileResult,
): void {
  if (depth > MAX_DEPTH) return;

  let entries: string[];
  try {
    entries = readdirSync(current);
  } catch {
    return;
  }

  for (const name of entries) {
    if (SKIP_DIRS.has(name)) continue;

    const full = resolve(current, name);
    let stat;
    try {
      stat = statSync(full);
    } catch {
      continue;
    }
    if (!stat.isDirectory()) continue;

    // Found a `.pinakes/` — is it the canonical one or a stray?
    if (name === '.pinakes') {
      if (full === canonicalPinakes) continue;
      result.strays.push(recoverStray(full, projectRoot, canonicalWiki));
      continue;
    }

    // Subdir with its own `.git` is a nested repo — leave it alone.
    if (existsSync(resolve(full, '.git'))) continue;

    walk(projectRoot, full, canonicalPinakes, canonicalWiki, depth + 1, result);
  }
}

function recoverStray(
  strayPath: string,
  projectRoot: string,
  canonicalWiki: string,
): StrayReport {
  const report: StrayReport = {
    strayPath,
    filesRecovered: [],
    filesSkipped: [],
    removed: false,
  };

  const strayWiki = resolve(strayPath, 'wiki');
  if (existsSync(strayWiki)) {
    const relStray = relative(projectRoot, resolve(strayPath, '..'));
    const recoveredRoot = resolve(
      canonicalWiki,
      'recovered',
      relStray || basename(strayPath),
    );
    copyTree(strayWiki, recoveredRoot, '', report);
  }

  try {
    rmSync(strayPath, { recursive: true, force: true });
    report.removed = true;
  } catch (err) {
    logger.warn({ err, strayPath }, 'failed to remove stray .pinakes dir');
  }

  return report;
}

function copyTree(
  srcDir: string,
  dstDir: string,
  relPrefix: string,
  report: StrayReport,
): void {
  let entries: string[];
  try {
    entries = readdirSync(srcDir);
  } catch {
    return;
  }

  for (const name of entries) {
    const src = resolve(srcDir, name);
    const dst = resolve(dstDir, name);
    const rel = relPrefix ? `${relPrefix}/${name}` : name;

    let stat;
    try {
      stat = statSync(src);
    } catch {
      continue;
    }

    if (stat.isDirectory()) {
      copyTree(src, dst, rel, report);
      continue;
    }

    if (!name.endsWith('.md')) continue;

    if (existsSync(dst)) {
      report.filesSkipped.push(rel);
      continue;
    }

    try {
      mkdirSync(dirname(dst), { recursive: true });
      cpSync(src, dst);
      report.filesRecovered.push(rel);
    } catch (err) {
      logger.warn({ err, src, dst }, 'failed to recover stray wiki file');
      report.filesSkipped.push(rel);
    }
  }
}
