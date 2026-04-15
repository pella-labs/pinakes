import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { reconcileStrayPinakesDirs } from '../../init/reconcile.js';

describe('init/reconcile', () => {
  let tmp: string;
  let projectRoot: string;
  let canonicalWiki: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'pinakes-reconcile-'));
    projectRoot = join(tmp, 'repo');
    canonicalWiki = join(projectRoot, '.pinakes', 'wiki');
    mkdirSync(canonicalWiki, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('ignores the canonical .pinakes/ itself', () => {
    writeFileSync(join(canonicalWiki, 'overview.md'), '# Overview');

    const result = reconcileStrayPinakesDirs(projectRoot, canonicalWiki);

    expect(result.strays).toEqual([]);
    expect(existsSync(join(projectRoot, '.pinakes'))).toBe(true);
  });

  it('recovers markdown from a stray subdir into wiki/recovered/ and deletes the stray', () => {
    const stray = join(projectRoot, 'crates', 'goose', '.pinakes');
    mkdirSync(join(stray, 'wiki'), { recursive: true });
    writeFileSync(join(stray, 'wiki', 'notes.md'), '# Goose notes');
    mkdirSync(join(stray, 'wiki', 'decisions'), { recursive: true });
    writeFileSync(join(stray, 'wiki', 'decisions', 'auth.md'), '# Auth');

    const result = reconcileStrayPinakesDirs(projectRoot, canonicalWiki);

    expect(result.strays.length).toBe(1);
    const stray0 = result.strays[0]!;
    expect(stray0.strayPath).toBe(stray);
    expect(stray0.removed).toBe(true);
    expect(stray0.filesRecovered.sort()).toEqual(['decisions/auth.md', 'notes.md']);
    expect(stray0.filesSkipped).toEqual([]);

    expect(existsSync(stray)).toBe(false);
    const recoveredBase = join(canonicalWiki, 'recovered', 'crates', 'goose');
    expect(readFileSync(join(recoveredBase, 'notes.md'), 'utf-8')).toBe('# Goose notes');
    expect(readFileSync(join(recoveredBase, 'decisions', 'auth.md'), 'utf-8')).toBe('# Auth');
  });

  it('never overwrites existing files in the canonical wiki', () => {
    const stray = join(projectRoot, 'pkg', '.pinakes');
    mkdirSync(join(stray, 'wiki'), { recursive: true });
    writeFileSync(join(stray, 'wiki', 'dup.md'), '# Stray version');

    mkdirSync(join(canonicalWiki, 'recovered', 'pkg'), { recursive: true });
    writeFileSync(join(canonicalWiki, 'recovered', 'pkg', 'dup.md'), '# Canonical');

    const result = reconcileStrayPinakesDirs(projectRoot, canonicalWiki);

    expect(result.strays[0]!.filesSkipped).toEqual(['dup.md']);
    expect(result.strays[0]!.filesRecovered).toEqual([]);
    expect(readFileSync(join(canonicalWiki, 'recovered', 'pkg', 'dup.md'), 'utf-8')).toBe('# Canonical');
  });

  it('skips nested git repos (their .pinakes is legitimate)', () => {
    const nested = join(projectRoot, 'vendor', 'submodule');
    const nestedPinakes = join(nested, '.pinakes');
    mkdirSync(join(nestedPinakes, 'wiki'), { recursive: true });
    mkdirSync(join(nested, '.git'));
    writeFileSync(join(nestedPinakes, 'wiki', 'keep.md'), '# Keep me');

    const result = reconcileStrayPinakesDirs(projectRoot, canonicalWiki);

    expect(result.strays).toEqual([]);
    expect(existsSync(nestedPinakes)).toBe(true);
  });

  it('skips node_modules and target while walking', () => {
    const inNodeModules = join(projectRoot, 'node_modules', 'foo', '.pinakes');
    const inTarget = join(projectRoot, 'target', 'debug', '.pinakes');
    mkdirSync(join(inNodeModules, 'wiki'), { recursive: true });
    mkdirSync(join(inTarget, 'wiki'), { recursive: true });
    writeFileSync(join(inNodeModules, 'wiki', 'x.md'), '# x');
    writeFileSync(join(inTarget, 'wiki', 'y.md'), '# y');

    const result = reconcileStrayPinakesDirs(projectRoot, canonicalWiki);

    expect(result.strays).toEqual([]);
    expect(existsSync(inNodeModules)).toBe(true);
    expect(existsSync(inTarget)).toBe(true);
  });

  it('removes a stray with no wiki content', () => {
    const stray = join(projectRoot, 'app', '.pinakes');
    mkdirSync(stray, { recursive: true });
    writeFileSync(join(stray, '.gitignore'), 'pinakes.db\n');

    const result = reconcileStrayPinakesDirs(projectRoot, canonicalWiki);

    expect(result.strays.length).toBe(1);
    expect(result.strays[0]!.removed).toBe(true);
    expect(result.strays[0]!.filesRecovered).toEqual([]);
    expect(existsSync(stray)).toBe(false);
  });
});
