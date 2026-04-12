import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { scanRepoMarkdownFiles } from '../../init/scanner.js';

describe('init/scanner', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'pinakes-scanner-'));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('finds .md files in a flat directory', () => {
    writeFileSync(join(tmp, 'README.md'), '# Hello');
    writeFileSync(join(tmp, 'CONTRIBUTING.md'), '# Contributing');
    writeFileSync(join(tmp, 'index.ts'), 'export {}');

    const files = scanRepoMarkdownFiles(tmp);
    expect(files.length).toBe(2);
    expect(files.some((f) => f.endsWith('README.md'))).toBe(true);
    expect(files.some((f) => f.endsWith('CONTRIBUTING.md'))).toBe(true);
  });

  it('finds .md files in nested directories', () => {
    mkdirSync(join(tmp, 'docs'), { recursive: true });
    mkdirSync(join(tmp, 'docs', 'api'), { recursive: true });
    writeFileSync(join(tmp, 'README.md'), '# Root');
    writeFileSync(join(tmp, 'docs', 'guide.md'), '# Guide');
    writeFileSync(join(tmp, 'docs', 'api', 'endpoints.md'), '# API');

    const files = scanRepoMarkdownFiles(tmp);
    expect(files.length).toBe(3);
  });

  it('excludes .pinakes/ directory', () => {
    mkdirSync(join(tmp, '.pinakes', 'wiki'), { recursive: true });
    writeFileSync(join(tmp, 'README.md'), '# Root');
    writeFileSync(join(tmp, '.pinakes', 'wiki', 'existing.md'), '# Existing');

    const files = scanRepoMarkdownFiles(tmp);
    expect(files.length).toBe(1);
    expect(files[0]!.endsWith('README.md')).toBe(true);
  });

  it('excludes node_modules/', () => {
    mkdirSync(join(tmp, 'node_modules', 'pkg'), { recursive: true });
    writeFileSync(join(tmp, 'README.md'), '# Root');
    writeFileSync(join(tmp, 'node_modules', 'pkg', 'README.md'), '# Package');

    const files = scanRepoMarkdownFiles(tmp);
    expect(files.length).toBe(1);
  });

  it('returns empty array for directory with no .md files', () => {
    writeFileSync(join(tmp, 'index.ts'), 'export {}');

    const files = scanRepoMarkdownFiles(tmp);
    expect(files.length).toBe(0);
  });

  it('returns sorted paths', () => {
    writeFileSync(join(tmp, 'z.md'), '# Z');
    writeFileSync(join(tmp, 'a.md'), '# A');
    writeFileSync(join(tmp, 'm.md'), '# M');

    const files = scanRepoMarkdownFiles(tmp);
    const names = files.map((f) => f.split('/').pop());
    expect(names).toEqual(['a.md', 'm.md', 'z.md']);
  });
});
