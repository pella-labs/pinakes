import {
  mkdtempSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  parseDiff,
  filterDiff,
  truncateDiff,
  parseLlmDrafts,
} from '../../cli/crystallize.js';

// ---------------------------------------------------------------------------
// Fixture: unified diff with multiple files
// ---------------------------------------------------------------------------

const FIXTURE_DIFF = `diff --git a/src/server.ts b/src/server.ts
index abc1234..def5678 100644
--- a/src/server.ts
+++ b/src/server.ts
@@ -10,6 +10,8 @@ import { logger } from './logger.js';

 const app = express();

+// Added rate limiting middleware
+app.use(rateLimit({ windowMs: 60000, max: 100 }));
+
 app.get('/health', (req, res) => {
   res.json({ ok: true });
 });
diff --git a/src/auth.test.ts b/src/auth.test.ts
index 1111111..2222222 100644
--- a/src/auth.test.ts
+++ b/src/auth.test.ts
@@ -1,3 +1,5 @@
+import { expect } from 'vitest';
+
 describe('auth', () => {
   it('works', () => {
     expect(true).toBe(true);
diff --git a/package-lock.json b/package-lock.json
index 3333333..4444444 100644
--- a/package-lock.json
+++ b/package-lock.json
@@ -1,5 +1,5 @@
-  "version": "1.0.0",
+  "version": "1.1.0",
   "dependencies": {
diff --git a/src/config.ts b/src/config.ts
index 5555555..6666666 100644
--- a/src/config.ts
+++ b/src/config.ts
@@ -5,3 +5,10 @@ export const config = {
   port: 3000,
+  rateLimit: {
+    windowMs: 60_000,
+    max: 100,
+  },
+  cors: {
+    origin: '*',
+  },
 };
`;

// ---------------------------------------------------------------------------
// parseDiff
// ---------------------------------------------------------------------------

describe('cli/crystallize parseDiff', () => {
  it('splits unified diff into per-file entries', () => {
    const entries = parseDiff(FIXTURE_DIFF);
    expect(entries).toHaveLength(4);
    expect(entries.map((e) => e.filePath)).toEqual([
      'src/server.ts',
      'src/auth.test.ts',
      'package-lock.json',
      'src/config.ts',
    ]);
  });

  it('counts significant lines (skips blank/whitespace-only changes)', () => {
    const entries = parseDiff(FIXTURE_DIFF);
    const server = entries.find((e) => e.filePath === 'src/server.ts')!;
    expect(server.significantLines).toBe(2);

    const config = entries.find((e) => e.filePath === 'src/config.ts')!;
    expect(config.significantLines).toBeGreaterThanOrEqual(6);
  });

  it('handles empty diff', () => {
    expect(parseDiff('')).toEqual([]);
    expect(parseDiff('\n\n')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// filterDiff
// ---------------------------------------------------------------------------

describe('cli/crystallize filterDiff', () => {
  it('excludes test files and lockfiles by default', () => {
    const entries = parseDiff(FIXTURE_DIFF);
    const filtered = filterDiff(entries);

    const paths = filtered.map((e) => e.filePath);
    expect(paths).toContain('src/server.ts');
    expect(paths).toContain('src/config.ts');
    expect(paths).not.toContain('src/auth.test.ts');
    expect(paths).not.toContain('package-lock.json');
  });

  it('respects custom exclude patterns', () => {
    const entries = parseDiff(FIXTURE_DIFF);
    const filtered = filterDiff(entries, { exclude: ['*.ts'] });

    const paths = filtered.map((e) => e.filePath);
    expect(paths).not.toContain('src/server.ts');
    expect(paths).not.toContain('src/config.ts');
    expect(paths).toContain('package-lock.json');
  });

  it('respects custom include patterns', () => {
    const entries = parseDiff(FIXTURE_DIFF);
    const filtered = filterDiff(entries, {
      exclude: [],
      include: ['src/config.ts'],
    });

    expect(filtered).toHaveLength(1);
    expect(filtered[0]!.filePath).toBe('src/config.ts');
  });
});

// ---------------------------------------------------------------------------
// Minimum diff threshold
// ---------------------------------------------------------------------------

describe('cli/crystallize minimum diff threshold', () => {
  it('total significant lines computed correctly', () => {
    const entries = parseDiff(FIXTURE_DIFF);
    const filtered = filterDiff(entries);
    const total = filtered.reduce((s, e) => s + e.significantLines, 0);

    // With default threshold (10), the fixture should be borderline
    expect(total).toBeGreaterThanOrEqual(8);
    expect(total).toBeLessThan(1000);
  });
});

// ---------------------------------------------------------------------------
// Truncation
// ---------------------------------------------------------------------------

describe('cli/crystallize truncateDiff', () => {
  it('returns original when under limit', () => {
    const result = truncateDiff('short diff', 1000);
    expect(result).toBe('short diff');
  });

  it('truncates large diffs with marker', () => {
    const bigDiff = 'x'.repeat(500_000);
    const result = truncateDiff(bigDiff, 100);
    expect(result.length).toBeLessThan(bigDiff.length);
    expect(result).toContain('[... diff truncated due to size ...]');
  });
});

// ---------------------------------------------------------------------------
// LLM response parsing
// ---------------------------------------------------------------------------

describe('cli/crystallize parseLlmDrafts', () => {
  it('splits LLM response into draft pages', () => {
    const response = [
      '# Rate Limiting Decision',
      '',
      'We added rate limiting to the server.',
      '',
      '---PAGE_BREAK---',
      '',
      '# CORS Configuration',
      '',
      'CORS was configured with a wildcard origin.',
    ].join('\n');

    const drafts = parseLlmDrafts(response);
    expect(drafts).toHaveLength(2);
    expect(drafts[0]!.title).toBe('Rate Limiting Decision');
    expect(drafts[1]!.title).toBe('CORS Configuration');
  });

  it('handles single page (no separator)', () => {
    const response = '# Single Page\n\nContent here.';
    const drafts = parseLlmDrafts(response);
    expect(drafts).toHaveLength(1);
    expect(drafts[0]!.title).toBe('Single Page');
  });

  it('handles empty response', () => {
    expect(parseLlmDrafts('')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Confidence detection for crystallized files
// ---------------------------------------------------------------------------

describe('cli/crystallize confidence integration', () => {
  it('detectConfidence returns crystallized for crystallized frontmatter', async () => {
    const { detectConfidence } = await import('../../ingest/parse/markdown.js');
    const source = '---\nconfidence: crystallized\nsource: crystallize\n---\n\n# My Page';
    expect(detectConfidence(source)).toBe('crystallized');
  });

  it('detectConfidence returns extracted for normal files', async () => {
    const { detectConfidence } = await import('../../ingest/parse/markdown.js');
    expect(detectConfidence('# Normal Page\n\nContent.')).toBe('extracted');
  });
});
