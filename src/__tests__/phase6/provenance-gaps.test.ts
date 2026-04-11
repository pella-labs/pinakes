import { afterAll, afterEach, describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { closeDb, openDb, type DbBundle } from '../../db/client.js';
import { Repository } from '../../db/repository.js';
import { IngesterService, __resetSingleFlightForTests } from '../../ingest/ingester.js';
import { CountingEmbedder, getDefaultEmbedder } from '../../retrieval/embedder.js';
import { QuickJSExecutor } from '../../sandbox/executor.js';
import type { BindingDeps } from '../../sandbox/bindings/install.js';
import { detectConfidence } from '../../ingest/parse/markdown.js';
import { extractConcepts, queryGaps } from '../../gaps/detector.js';

/**
 * Phase 6 tests — provenance (confidence) + gap detection.
 *
 * Tests:
 *   1. detectConfidence: 'extracted' default
 *   2. detectConfidence: 'inferred' from frontmatter
 *   3. detectConfidence: 'ambiguous' from frontmatter
 *   4. Confidence column populated on ingest
 *   5. Filter by confidence inside kg_execute sandbox
 *   6. extractConcepts: bold, wikilinks, backticks
 *   7. Gap detection: ≥3 concept mentions → kg_gaps row
 *   8. Gap resolution: dedicated node → resolved_at set
 *   9. kg.project.gaps() returns unresolved gaps via sandbox
 *  10. kg.project.gaps({ resolved: true }) includes resolved
 *  11. kg.personal.gaps() respects scope isolation
 *  12. Gap fill via write → resolved on next ingest
 *  13. source_uri present on query results
 */

const FIXTURE_DIR = resolve(
  fileURLToPath(new URL('../fixtures/wiki', import.meta.url))
);

// ============================================================================
// Confidence detection (3 tests — pure function, no DB)
// ============================================================================

describe('detectConfidence (Phase 6)', () => {
  it("returns 'extracted' by default (no frontmatter)", () => {
    expect(detectConfidence('# Hello\n\nSome content here.')).toBe('extracted');
  });

  it("returns 'inferred' for source: haiku frontmatter", () => {
    const md = `---\nsource: haiku\n---\n# Summary\n\nAI-generated summary.`;
    expect(detectConfidence(md)).toBe('inferred');
  });

  it("returns 'inferred' for source: ai-generated frontmatter", () => {
    const md = `---\nsource: ai-generated\n---\n# Summary\n\nGenerated.`;
    expect(detectConfidence(md)).toBe('inferred');
  });

  it("returns 'ambiguous' for status: ambiguous frontmatter", () => {
    const md = `---\nstatus: ambiguous\n---\n# Unclear\n\nNeeds review.`;
    expect(detectConfidence(md)).toBe('ambiguous');
  });

  it("returns 'ambiguous' for confidence: ambiguous frontmatter", () => {
    const md = `---\nconfidence: ambiguous\n---\n# Flagged\n\nFlagged content.`;
    expect(detectConfidence(md)).toBe('ambiguous');
  });
});

// ============================================================================
// Concept extraction (1 test — pure function)
// ============================================================================

describe('extractConcepts (Phase 6)', () => {
  it('extracts bold, wikilinks, and backtick terms', () => {
    const content = `
We use **bcrypt** for hashing. The [[login flow]] handles authentication.
See also \`hashPassword\` and **session tokens** for details.
The [[login flow|Login]] is documented elsewhere.
    `;
    const concepts = extractConcepts(content);
    expect(concepts.has('bcrypt')).toBe(true);
    expect(concepts.has('login flow')).toBe(true);
    expect(concepts.has('hashpassword')).toBe(true);
    expect(concepts.has('session tokens')).toBe(true);
    // Deduplication: [[login flow]] and [[login flow|Login]] → one entry
    const arr = [...concepts].filter((c) => c === 'login flow');
    expect(arr.length).toBe(1);
  });
});

// ============================================================================
// Integration tests (DB-backed)
// ============================================================================

describe('Phase 6 integration', () => {
  let bundle: DbBundle;
  let repository: Repository;
  let executor: QuickJSExecutor;
  let tmpRoot: string;
  let wikiDir: string;
  let embedder: CountingEmbedder;

  function makeDeps(overrides?: Partial<BindingDeps>): BindingDeps {
    return {
      project: { repository, bundle, scope: 'project', embedder, wikiRoot: wikiDir },
      maxTokens: 5000,
      logs: [],
      ...overrides,
    };
  }

  beforeAll(async () => {
    executor = new QuickJSExecutor();
    await executor.warmup();
    embedder = new CountingEmbedder(getDefaultEmbedder());
    await embedder.warmup();
  });

  afterAll(() => {
    executor?.dispose();
  });

  beforeEach(() => {
    __resetSingleFlightForTests();
    tmpRoot = mkdtempSync(join(tmpdir(), 'kg-phase6-'));
    wikiDir = join(tmpRoot, 'wiki');
    mkdirSync(wikiDir, { recursive: true });
    bundle = openDb(join(tmpRoot, 'kg.db'));
    repository = new Repository(bundle);
  });

  afterEach(() => {
    closeDb(bundle);
    rmSync(tmpRoot, { recursive: true, force: true });
    __resetSingleFlightForTests();
  });

  it('confidence column populated as extracted by default on ingest', async () => {
    // Write a plain markdown file (no frontmatter)
    writeFileSync(join(wikiDir, 'plain.md'), '# Test\n\nSome content.');
    const ingester = new IngesterService(bundle, embedder, 'project', wikiDir);
    await ingester.ingestFile(join(wikiDir, 'plain.md'));

    const row = bundle.writer
      .prepare<[], { confidence: string }>('SELECT confidence FROM kg_nodes LIMIT 1')
      .get();
    expect(row?.confidence).toBe('extracted');
  });

  it('confidence = inferred for AI-generated source', async () => {
    const md = `---\nsource: haiku\n---\n# AI Summary\n\nGenerated by Haiku.`;
    writeFileSync(join(wikiDir, 'ai.md'), md);
    const ingester = new IngesterService(bundle, embedder, 'project', wikiDir);
    await ingester.ingestFile(join(wikiDir, 'ai.md'));

    const row = bundle.writer
      .prepare<[], { confidence: string }>('SELECT confidence FROM kg_nodes LIMIT 1')
      .get();
    expect(row?.confidence).toBe('inferred');
  });

  it('confidence = ambiguous for flagged source', async () => {
    const md = `---\nstatus: ambiguous\n---\n# Unclear\n\nNeeds review.`;
    writeFileSync(join(wikiDir, 'flagged.md'), md);
    const ingester = new IngesterService(bundle, embedder, 'project', wikiDir);
    await ingester.ingestFile(join(wikiDir, 'flagged.md'));

    const row = bundle.writer
      .prepare<[], { confidence: string }>('SELECT confidence FROM kg_nodes LIMIT 1')
      .get();
    expect(row?.confidence).toBe('ambiguous');
  });

  it('filter by confidence inside kg_execute sandbox', async () => {
    // Ingest two files with different confidence levels
    writeFileSync(join(wikiDir, 'real.md'), '# Real Data\n\nExtracted content about authentication.');
    const aiMd = `---\nsource: haiku\n---\n# AI Summary\n\nInferred content about authentication.`;
    writeFileSync(join(wikiDir, 'ai.md'), aiMd);

    const ingester = new IngesterService(bundle, embedder, 'project', wikiDir);
    await ingester.ingestFile(join(wikiDir, 'real.md'));
    await ingester.ingestFile(join(wikiDir, 'ai.md'));

    const result = await executor.executeWithBindings(
      `const results = kg.project.fts('authentication');
       return results.filter(r => r.confidence === 'extracted');`,
      makeDeps()
    );
    expect(result.error).toBeUndefined();
    const arr = result.result as Array<{ confidence: string }>;
    expect(arr.length).toBeGreaterThan(0);
    for (const r of arr) {
      expect(r.confidence).toBe('extracted');
    }
  });

  it('gap detection: ≥3 concept mentions → kg_gaps row', async () => {
    // Create files that mention **bcrypt** ≥3 times across chunks
    writeFileSync(
      join(wikiDir, 'a.md'),
      '# Module A\n\nWe use **bcrypt** for hashing passwords securely.'
    );
    writeFileSync(
      join(wikiDir, 'b.md'),
      '# Module B\n\nThe **bcrypt** library provides cost-factor tuning.'
    );
    writeFileSync(
      join(wikiDir, 'c.md'),
      '# Module C\n\nAlways prefer **bcrypt** over MD5 for password storage.'
    );

    const ingester = new IngesterService(bundle, embedder, 'project', wikiDir);
    await ingester.ingestFile(join(wikiDir, 'a.md'));
    await ingester.ingestFile(join(wikiDir, 'b.md'));
    await ingester.ingestFile(join(wikiDir, 'c.md'));

    // "bcrypt" appears in ≥3 chunks; there's no node titled "bcrypt" → gap
    const gaps = queryGaps(bundle.writer, 'project');
    const bcryptGap = gaps.find((g) => g.topic === 'bcrypt');
    expect(bcryptGap).toBeDefined();
    expect(bcryptGap!.mentions_count).toBeGreaterThanOrEqual(3);
    expect(bcryptGap!.resolved_at).toBeNull();
  });

  it('gap resolution: dedicated node created → resolved_at set', async () => {
    // First, create the gap
    writeFileSync(
      join(wikiDir, 'a.md'),
      '# Module A\n\nWe use **bcrypt** for hashing.'
    );
    writeFileSync(
      join(wikiDir, 'b.md'),
      '# Module B\n\nThe **bcrypt** library is great.'
    );
    writeFileSync(
      join(wikiDir, 'c.md'),
      '# Module C\n\nPrefer **bcrypt** over MD5.'
    );

    const ingester = new IngesterService(bundle, embedder, 'project', wikiDir);
    await ingester.ingestFile(join(wikiDir, 'a.md'));
    await ingester.ingestFile(join(wikiDir, 'b.md'));
    await ingester.ingestFile(join(wikiDir, 'c.md'));

    // Gap should exist
    let gaps = queryGaps(bundle.writer, 'project');
    expect(gaps.find((g) => g.topic === 'bcrypt')).toBeDefined();

    // Now create a dedicated node titled "bcrypt"
    writeFileSync(join(wikiDir, 'bcrypt.md'), '# bcrypt\n\nA password hashing algorithm.');
    await ingester.ingestFile(join(wikiDir, 'bcrypt.md'));

    // The gap should be resolved
    const allGaps = queryGaps(bundle.writer, 'project', { resolved: true });
    const resolved = allGaps.find((g) => g.topic === 'bcrypt');
    expect(resolved).toBeDefined();
    expect(resolved!.resolved_at).not.toBeNull();
  });

  it('kg.project.gaps() returns unresolved gaps via sandbox', async () => {
    // Set up ≥3 mentions of a concept
    writeFileSync(join(wikiDir, 'x.md'), '# X\n\nUse **redis** for caching.');
    writeFileSync(join(wikiDir, 'y.md'), '# Y\n\nThe **redis** server runs locally.');
    writeFileSync(join(wikiDir, 'z.md'), '# Z\n\n**redis** is fast.');

    const ingester = new IngesterService(bundle, embedder, 'project', wikiDir);
    await ingester.ingestFile(join(wikiDir, 'x.md'));
    await ingester.ingestFile(join(wikiDir, 'y.md'));
    await ingester.ingestFile(join(wikiDir, 'z.md'));

    const result = await executor.executeWithBindings(
      'return kg.project.gaps()',
      makeDeps()
    );
    expect(result.error).toBeUndefined();
    const arr = result.result as Array<{ topic: string; resolved_at: null }>;
    const redisGap = arr.find((g) => g.topic === 'redis');
    expect(redisGap).toBeDefined();
    expect(redisGap!.resolved_at).toBeNull();
  });

  it('kg.project.gaps({ resolved: true }) includes historical resolutions', async () => {
    writeFileSync(join(wikiDir, 'a.md'), '# A\n\nUse **jwt** tokens.');
    writeFileSync(join(wikiDir, 'b.md'), '# B\n\nA **jwt** is signed.');
    writeFileSync(join(wikiDir, 'c.md'), '# C\n\nVerify **jwt** on each request.');

    const ingester = new IngesterService(bundle, embedder, 'project', wikiDir);
    await ingester.ingestFile(join(wikiDir, 'a.md'));
    await ingester.ingestFile(join(wikiDir, 'b.md'));
    await ingester.ingestFile(join(wikiDir, 'c.md'));

    // Resolve by creating a dedicated node
    writeFileSync(join(wikiDir, 'jwt.md'), '# jwt\n\nJSON Web Tokens for auth.');
    await ingester.ingestFile(join(wikiDir, 'jwt.md'));

    // Default gaps() should not include resolved
    const r1 = await executor.executeWithBindings(
      'return kg.project.gaps()',
      makeDeps()
    );
    const unresolvedArr = r1.result as Array<{ topic: string }>;
    expect(unresolvedArr.find((g) => g.topic === 'jwt')).toBeUndefined();

    // With { resolved: true } should include it
    const r2 = await executor.executeWithBindings(
      'return kg.project.gaps({ resolved: true })',
      makeDeps()
    );
    const allArr = r2.result as Array<{ topic: string; resolved_at: number | null }>;
    const jwtGap = allArr.find((g) => g.topic === 'jwt');
    expect(jwtGap).toBeDefined();
    expect(jwtGap!.resolved_at).not.toBeNull();
  });

  it('kg.personal.gaps() respects scope isolation', async () => {
    // Set up project gaps
    writeFileSync(join(wikiDir, 'a.md'), '# A\n\nUse **graphql** queries.');
    writeFileSync(join(wikiDir, 'b.md'), '# B\n\nA **graphql** schema.');
    writeFileSync(join(wikiDir, 'c.md'), '# C\n\n**graphql** resolvers.');

    const ingester = new IngesterService(bundle, embedder, 'project', wikiDir);
    await ingester.ingestFile(join(wikiDir, 'a.md'));
    await ingester.ingestFile(join(wikiDir, 'b.md'));
    await ingester.ingestFile(join(wikiDir, 'c.md'));

    // Set up a separate personal DB + wiki
    const personalTmp = join(tmpRoot, 'personal');
    const personalWiki = join(personalTmp, 'wiki');
    mkdirSync(personalWiki, { recursive: true });
    const personalBundle = openDb(join(personalTmp, 'kg.db'));

    try {
      const personalRepo = new Repository(personalBundle);
      const deps = makeDeps({
        personal: { repository: personalRepo, bundle: personalBundle, scope: 'personal', embedder },
      });

      // personal.gaps() should return empty (no personal ingest)
      const r = await executor.executeWithBindings(
        'return kg.personal.gaps()',
        deps
      );
      expect(r.error).toBeUndefined();
      expect(r.result).toEqual([]);

      // project.gaps() should still return the graphql gap
      const r2 = await executor.executeWithBindings(
        'return kg.project.gaps()',
        deps
      );
      const arr = r2.result as Array<{ topic: string }>;
      expect(arr.find((g) => g.topic === 'graphql')).toBeDefined();
    } finally {
      closeDb(personalBundle);
    }
  });

  it('gap fill via write → resolved on next ingest', async () => {
    // Create the gap
    writeFileSync(join(wikiDir, 'a.md'), '# A\n\nUse **webpack** bundler.');
    writeFileSync(join(wikiDir, 'b.md'), '# B\n\n**webpack** config is complex.');
    writeFileSync(join(wikiDir, 'c.md'), '# C\n\nOptimize **webpack** builds.');

    const ingester = new IngesterService(bundle, embedder, 'project', wikiDir);
    await ingester.ingestFile(join(wikiDir, 'a.md'));
    await ingester.ingestFile(join(wikiDir, 'b.md'));
    await ingester.ingestFile(join(wikiDir, 'c.md'));

    // Verify gap exists
    let gaps = queryGaps(bundle.writer, 'project');
    expect(gaps.find((g) => g.topic === 'webpack')).toBeDefined();

    // Fill the gap via sandbox write (simulating what the LLM would do)
    const writeResult = await executor.executeWithBindings(
      `kg.project.write('webpack.md', '# webpack\\n\\nA JavaScript module bundler.');
       return 'written';`,
      makeDeps({
        project: {
          repository, bundle, scope: 'project', embedder,
          wikiRoot: wikiDir,
          writeCounter: { count: 0 },
        },
      })
    );
    expect(writeResult.error).toBeUndefined();

    // Re-ingest the newly created file (chokidar would do this in production)
    await ingester.ingestFile(join(wikiDir, 'webpack.md'));

    // Gap should now be resolved
    const allGaps = queryGaps(bundle.writer, 'project', { resolved: true });
    const webpackGap = allGaps.find((g) => g.topic === 'webpack');
    expect(webpackGap).toBeDefined();
    expect(webpackGap!.resolved_at).not.toBeNull();
  });

  it('source_uri present on FTS query results', async () => {
    writeFileSync(join(wikiDir, 'info.md'), '# Info\n\nSome searchable content here.');
    const ingester = new IngesterService(bundle, embedder, 'project', wikiDir);
    await ingester.ingestFile(join(wikiDir, 'info.md'));

    const result = await executor.executeWithBindings(
      `return kg.project.fts('searchable')`,
      makeDeps()
    );
    expect(result.error).toBeUndefined();
    const arr = result.result as Array<{ source_uri: string; confidence: string }>;
    expect(arr.length).toBeGreaterThan(0);
    // Project scope source_uri is a relative path (e.g. "info.md"), not a file:// URL.
    // file:// URLs are only used for personal scope (see toStoredUri in manifest.ts).
    expect(arr[0]!.source_uri).toBe('info.md');
    expect(arr[0]!.confidence).toBe('extracted');
  });

  it('nodeGet returns confidence field', async () => {
    const md = `---\nsource: ai\n---\n# AI Node\n\nSome inferred content.`;
    writeFileSync(join(wikiDir, 'inferred.md'), md);
    const ingester = new IngesterService(bundle, embedder, 'project', wikiDir);
    await ingester.ingestFile(join(wikiDir, 'inferred.md'));

    // Get a node id
    const nodeRow = bundle.writer
      .prepare<[], { id: string }>('SELECT id FROM kg_nodes LIMIT 1')
      .get();

    const result = await executor.executeWithBindings(
      `return kg.project.get('${nodeRow!.id}')`,
      makeDeps()
    );
    expect(result.error).toBeUndefined();
    const node = result.result as { confidence: string; source_uri: string };
    expect(node.confidence).toBe('inferred');
    // Project scope source_uri is relative path, not file:// URL
    expect(node.source_uri).toBe('inferred.md');
  });
});
