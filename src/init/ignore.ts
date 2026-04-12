import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';

import { logger } from '../observability/logger.js';

// .pinakesignore — filter which repo .md files get copied into the wiki.
//
// Supports a subset of .gitignore syntax:
//   dir/          → ignore everything under this top-level directory
//   ** /dir/      → ignore this directory name at any depth
//   ** /dir/**    → same as above
//   dir/**        → same as dir/
//   filename.md   → ignore files with this exact name anywhere
//   *.ext         → ignore files with this extension
//   !pattern      → re-include a previously ignored pattern
//   # lines       → comments
//   blank lines   → ignored

// Built-in defaults — applied before .pinakesignore patterns.
// These filter out source-code directories whose READMEs are typically
// boilerplate and not useful project documentation.
const BUILTIN_IGNORE = `
# Source code directories — their .md files are usually boilerplate
**/src/
**/lib/
**/pkg/
**/cmd/
**/internal/
**/test/
**/tests/
**/spec/
**/fixtures/
**/testdata/
**/mocks/
**/__tests__/
**/__mocks__/

# Build & tooling
**/bin/
**/scripts/
**/tools/
**/hack/
**/.changeset/

# Language-specific source trees
**/crates/
**/packages/
**/apps/

# UI/frontend source
**/components/
**/pages/
**/views/
**/layouts/
**/public/

# Examples & evals (usually not core docs)
**/examples/
**/evals/
**/benchmarks/
**/samples/
`;

export interface IgnorePattern {
  /** The original pattern string (for debugging) */
  raw: string;
  /** Whether this is a negation pattern (starts with !) */
  negate: boolean;
  /** The test function */
  test: (relativePath: string) => boolean;
}

/**
 * Load ignore patterns from `.pinakesignore` in the project root,
 * merged with built-in defaults. User patterns override defaults.
 */
export function loadIgnorePatterns(projectRoot: string): IgnorePattern[] {
  const patterns: IgnorePattern[] = [];

  // Built-in defaults first
  patterns.push(...parsePatterns(BUILTIN_IGNORE));

  // User overrides from .pinakesignore
  const ignorePath = resolve(projectRoot, '.pinakesignore');
  if (existsSync(ignorePath)) {
    const content = readFileSync(ignorePath, 'utf-8');
    patterns.push(...parsePatterns(content));
  }

  return patterns;
}

const DEFAULT_PINAKESIGNORE = `# .pinakesignore — controls which repo .md files get copied into the wiki.
# Uses .gitignore-style patterns. Built-in defaults already exclude common
# source directories (src/, bin/, crates/, examples/, etc.).
# Add project-specific patterns below.

# To re-include a directory excluded by defaults, use negation:
# !**/src/

# Project-specific ignores:
`;

/**
 * Create a default `.pinakesignore` in the project root if one doesn't exist.
 * Called during serve startup alongside .gitignore generation.
 */
export function ensurePinakesIgnoreFile(projectRoot: string): void {
  const ignorePath = resolve(projectRoot, '.pinakesignore');
  if (existsSync(ignorePath)) return;
  writeFileSync(ignorePath, DEFAULT_PINAKESIGNORE, 'utf-8');
}

/**
 * Remove wiki files that match the current ignore patterns.
 * Called when `.pinakesignore` changes to clean up previously-copied files.
 */
export function cleanIgnoredFromWiki(
  _projectRoot: string,
  wikiRoot: string,
  patterns: IgnorePattern[],
): number {
  let removed = 0;

  function walkWiki(dir: string): void {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walkWiki(full);
        // Clean up empty dirs after removing files
        try {
          const remaining = readdirSync(full);
          if (remaining.length === 0) rmSync(full, { recursive: true });
        } catch { /* ignore */ }
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        const relFromWiki = relative(wikiRoot, full);
        if (shouldIgnore(relFromWiki, patterns)) {
          rmSync(full);
          removed++;
          logger.debug({ path: relFromWiki }, 'removed ignored file from wiki');
        }
      }
    }
  }

  walkWiki(wikiRoot);
  return removed;
}

/**
 * Check if a relative path should be ignored based on the patterns.
 * Later patterns (including negations) override earlier ones.
 */
export function shouldIgnore(relativePath: string, patterns: IgnorePattern[]): boolean {
  // Normalize: ensure forward slashes, no leading ./
  const normalized = relativePath.replace(/\\/g, '/').replace(/^\.\//, '');

  let ignored = false;
  for (const pattern of patterns) {
    if (pattern.test(normalized)) {
      ignored = !pattern.negate;
    }
  }
  return ignored;
}

// ---------------------------------------------------------------------------
// Pattern parsing
// ---------------------------------------------------------------------------

function parsePatterns(content: string): IgnorePattern[] {
  const patterns: IgnorePattern[] = [];

  for (let line of content.split('\n')) {
    line = line.trim();
    if (line === '' || line.startsWith('#')) continue;

    const negate = line.startsWith('!');
    const raw = line;
    if (negate) line = line.slice(1);

    const test = compilePattern(line);
    if (test) {
      patterns.push({ raw, negate, test });
    }
  }

  return patterns;
}

function compilePattern(pattern: string): ((path: string) => boolean) | null {
  // `**/dir/` or `**/dir/**` → directory name anywhere in path
  const anyDirMatch = pattern.match(/^\*\*\/([^/*]+)\/(\*\*)?$/);
  if (anyDirMatch) {
    const dirName = anyDirMatch[1]!;
    return (p) => {
      const segments = p.split('/');
      // Check if any segment (except the last, which is the filename) matches
      return segments.slice(0, -1).includes(dirName);
    };
  }

  // `dir/` or `dir/**` → top-level directory
  const topDirMatch = pattern.match(/^([^/*]+)\/(\*\*)?$/);
  if (topDirMatch) {
    const dirName = topDirMatch[1]!;
    return (p) => p.startsWith(dirName + '/');
  }

  // `*.ext` → extension match
  if (pattern.startsWith('*.') && !pattern.includes('/')) {
    const ext = pattern.slice(1); // includes the dot
    return (p) => p.endsWith(ext);
  }

  // `filename` (no slashes, no wildcards) → basename match anywhere
  if (!pattern.includes('/') && !pattern.includes('*')) {
    return (p) => basename(p) === pattern;
  }

  // `dir/subdir/` → prefix match
  if (pattern.endsWith('/') && !pattern.includes('*')) {
    return (p) => p.startsWith(pattern) || p.startsWith(pattern.slice(0, -1) + '/');
  }

  // Fallback: treat as a prefix
  if (!pattern.includes('*')) {
    return (p) => p.startsWith(pattern) || p === pattern;
  }

  return null; // unsupported pattern — skip silently
}
