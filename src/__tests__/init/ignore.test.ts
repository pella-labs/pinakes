import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadIgnorePatterns, shouldIgnore } from '../../init/ignore.js';

describe('init/ignore', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'pinakes-ignore-'));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  describe('built-in defaults', () => {
    it('ignores files under **/src/', () => {
      const patterns = loadIgnorePatterns(tmp);
      expect(shouldIgnore('crates/goose/src/README.md', patterns)).toBe(true);
      expect(shouldIgnore('src/README.md', patterns)).toBe(true);
    });

    it('ignores files under **/bin/', () => {
      const patterns = loadIgnorePatterns(tmp);
      expect(shouldIgnore('bin/README.hermit.md', patterns)).toBe(true);
    });

    it('ignores files under **/crates/', () => {
      const patterns = loadIgnorePatterns(tmp);
      expect(shouldIgnore('crates/goose/README.md', patterns)).toBe(true);
    });

    it('ignores files under **/examples/', () => {
      const patterns = loadIgnorePatterns(tmp);
      expect(shouldIgnore('examples/mcp-wiki/README.md', patterns)).toBe(true);
    });

    it('ignores files under **/evals/', () => {
      const patterns = loadIgnorePatterns(tmp);
      expect(shouldIgnore('evals/scripts/README.md', patterns)).toBe(true);
    });

    it('ignores files under **/.changeset/', () => {
      const patterns = loadIgnorePatterns(tmp);
      expect(shouldIgnore('ui/.changeset/initial-release.md', patterns)).toBe(true);
    });

    it('allows top-level .md files', () => {
      const patterns = loadIgnorePatterns(tmp);
      expect(shouldIgnore('README.md', patterns)).toBe(false);
      expect(shouldIgnore('CONTRIBUTING.md', patterns)).toBe(false);
      expect(shouldIgnore('CLAUDE.md', patterns)).toBe(false);
      expect(shouldIgnore('SECURITY.md', patterns)).toBe(false);
    });

    it('allows docs/ directory', () => {
      const patterns = loadIgnorePatterns(tmp);
      expect(shouldIgnore('docs/architecture.md', patterns)).toBe(false);
      expect(shouldIgnore('docs/api/endpoints.md', patterns)).toBe(false);
    });

    it('allows documentation/ directory', () => {
      const patterns = loadIgnorePatterns(tmp);
      expect(shouldIgnore('documentation/getting-started.md', patterns)).toBe(false);
    });
  });

  describe('.pinakesignore file', () => {
    it('adds custom ignore patterns', () => {
      writeFileSync(join(tmp, '.pinakesignore'), 'drafts/\n');
      const patterns = loadIgnorePatterns(tmp);
      expect(shouldIgnore('drafts/wip.md', patterns)).toBe(true);
      expect(shouldIgnore('docs/final.md', patterns)).toBe(false);
    });

    it('supports negation to re-include', () => {
      writeFileSync(join(tmp, '.pinakesignore'), '!**/src/\n');
      const patterns = loadIgnorePatterns(tmp);
      // Built-in ignores src/, but user negation re-includes it
      expect(shouldIgnore('crates/goose/src/README.md', patterns)).toBe(false);
    });

    it('ignores comments and blank lines', () => {
      writeFileSync(join(tmp, '.pinakesignore'), '# comment\n\ndrafts/\n');
      const patterns = loadIgnorePatterns(tmp);
      expect(shouldIgnore('drafts/wip.md', patterns)).toBe(true);
      expect(shouldIgnore('README.md', patterns)).toBe(false);
    });

    it('supports basename matching', () => {
      writeFileSync(join(tmp, '.pinakesignore'), 'CHANGELOG.md\n');
      const patterns = loadIgnorePatterns(tmp);
      expect(shouldIgnore('CHANGELOG.md', patterns)).toBe(true);
      expect(shouldIgnore('docs/CHANGELOG.md', patterns)).toBe(true);
    });

    it('bare name matches as directory prefix too', () => {
      writeFileSync(join(tmp, '.pinakesignore'), 'oidc-proxy\n');
      const patterns = loadIgnorePatterns(tmp);
      expect(shouldIgnore('oidc-proxy/README.md', patterns)).toBe(true);
      expect(shouldIgnore('some/nested/oidc-proxy/README.md', patterns)).toBe(true);
      expect(shouldIgnore('README.md', patterns)).toBe(false);
    });

    it('supports extension matching', () => {
      writeFileSync(join(tmp, '.pinakesignore'), '*.draft.md\n');
      const patterns = loadIgnorePatterns(tmp);
      expect(shouldIgnore('notes.draft.md', patterns)).toBe(true);
      expect(shouldIgnore('docs/wip.draft.md', patterns)).toBe(true);
      expect(shouldIgnore('README.md', patterns)).toBe(false);
    });
  });
});
