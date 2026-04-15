import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { findGitRoot, resolveProjectRoot } from '../../paths.js';

describe('paths/resolve-project-root', () => {
  let tmp: string;
  let originalCwd: string;

  beforeEach(() => {
    tmp = realpathSync(mkdtempSync(join(tmpdir(), 'pinakes-project-root-resolve-')));
    originalCwd = process.cwd();
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(tmp, { recursive: true, force: true });
  });

  it('findGitRoot walks up to the repo with `.git` dir', () => {
    const repo = join(tmp, 'repo');
    const sub = join(repo, 'crates', 'goose');
    mkdirSync(sub, { recursive: true });
    mkdirSync(join(repo, '.git'));

    expect(findGitRoot(sub)).toBe(repo);
    expect(findGitRoot(join(sub, 'does-not-exist'))).toBe(repo);
  });

  it('findGitRoot treats `.git` file (worktree) as a valid marker', () => {
    const repo = join(tmp, 'repo-worktree');
    const sub = join(repo, 'pkg', 'core');
    mkdirSync(sub, { recursive: true });
    writeFileSync(join(repo, '.git'), 'gitdir: ../actual/.git/worktrees/w1', 'utf-8');

    expect(findGitRoot(sub)).toBe(repo);
  });

  it('findGitRoot returns null when no `.git` exists', () => {
    const dir = join(tmp, 'no-git');
    mkdirSync(dir, { recursive: true });
    expect(findGitRoot(dir)).toBe(null);
  });

  it('resolveProjectRoot honors explicit override without walking', () => {
    const repo = join(tmp, 'repo-explicit');
    const somewhereElse = join(tmp, 'somewhere-else');
    mkdirSync(somewhereElse, { recursive: true });
    mkdirSync(join(repo, '.git'), { recursive: true });

    process.chdir(somewhereElse);
    expect(resolveProjectRoot(repo)).toBe(resolve(repo));
  });

  it('resolveProjectRoot walks up to the repo root when no flag is passed', () => {
    const repo = join(tmp, 'repo-walk');
    const sub = join(repo, 'crates', 'goose');
    mkdirSync(sub, { recursive: true });
    mkdirSync(join(repo, '.git'));

    process.chdir(sub);
    expect(resolveProjectRoot()).toBe(resolve(repo));
  });

  it('resolveProjectRoot falls back to cwd when no `.git` is present', () => {
    const dir = join(tmp, 'scratch');
    mkdirSync(dir, { recursive: true });

    process.chdir(dir);
    expect(resolveProjectRoot()).toBe(resolve(dir));
  });
});
