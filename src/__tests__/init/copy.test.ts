import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { copyMarkdownToWiki } from '../../init/copy.js';

describe('init/copy', () => {
  let tmp: string;
  let projectRoot: string;
  let wikiRoot: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'pinakes-copy-'));
    projectRoot = join(tmp, 'project');
    wikiRoot = join(tmp, 'project', '.pinakes', 'wiki');
    mkdirSync(projectRoot, { recursive: true });
    mkdirSync(wikiRoot, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('copies files preserving directory structure', () => {
    mkdirSync(join(projectRoot, 'docs'), { recursive: true });
    writeFileSync(join(projectRoot, 'README.md'), '# Root');
    writeFileSync(join(projectRoot, 'docs', 'guide.md'), '# Guide');

    const files = [
      join(projectRoot, 'README.md'),
      join(projectRoot, 'docs', 'guide.md'),
    ];

    const result = copyMarkdownToWiki(files, projectRoot, wikiRoot);

    expect(result.files_copied).toBe(2);
    expect(result.files_skipped).toBe(0);
    expect(result.total_bytes).toBeGreaterThan(0);

    expect(existsSync(join(wikiRoot, 'README.md'))).toBe(true);
    expect(existsSync(join(wikiRoot, 'docs', 'guide.md'))).toBe(true);
    expect(readFileSync(join(wikiRoot, 'README.md'), 'utf-8')).toBe('# Root');
    expect(readFileSync(join(wikiRoot, 'docs', 'guide.md'), 'utf-8')).toBe('# Guide');
  });

  it('skips files that already exist in the target', () => {
    writeFileSync(join(projectRoot, 'README.md'), '# Updated');
    writeFileSync(join(wikiRoot, 'README.md'), '# Original');

    const result = copyMarkdownToWiki(
      [join(projectRoot, 'README.md')],
      projectRoot,
      wikiRoot,
    );

    expect(result.files_copied).toBe(0);
    expect(result.files_skipped).toBe(1);
    // Original content preserved
    expect(readFileSync(join(wikiRoot, 'README.md'), 'utf-8')).toBe('# Original');
  });

  it('handles empty file list', () => {
    const result = copyMarkdownToWiki([], projectRoot, wikiRoot);
    expect(result.files_copied).toBe(0);
    expect(result.files_skipped).toBe(0);
    expect(result.total_bytes).toBe(0);
  });

  it('skips files outside project root (safety)', () => {
    const outsideDir = join(tmp, 'outside');
    mkdirSync(outsideDir, { recursive: true });
    writeFileSync(join(outsideDir, 'evil.md'), '# Evil');

    const result = copyMarkdownToWiki(
      [join(outsideDir, 'evil.md')],
      projectRoot,
      wikiRoot,
    );

    expect(result.files_copied).toBe(0);
    expect(existsSync(join(wikiRoot, 'evil.md'))).toBe(false);
  });
});
