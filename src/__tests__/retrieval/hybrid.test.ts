import { afterAll, describe, it, expect, beforeAll } from 'vitest';
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { closeDb, openDb, nextReader, type DbBundle } from '../../db/client.js';
import { Repository } from '../../db/repository.js';
import { IngesterService, __resetSingleFlightForTests } from '../../ingest/ingester.js';
import { CountingEmbedder, getDefaultEmbedder, createEmbedder, TransformersEmbedder } from '../../retrieval/embedder.js';
import { ftsQuery, escapeFts5Query } from '../../retrieval/fts.js';
import { vecQuery, vecSearch } from '../../retrieval/vec.js';
import { hybridSearch, rrfFuse } from '../../retrieval/hybrid.js';
import { makeKgSearchHandler } from '../../mcp/tools/search.js';
import { makeKgExecuteHandler } from '../../mcp/tools/execute.js';
import { QuickJSExecutor } from '../../sandbox/executor.js';
import { computeInternalBudget, fitResults, countTokens } from '../../gate/budget.js';

/**
 * Phase 4 tests — hybrid retrieval, budget gate adversarial, ground truth.
 *
 * All tests use real SQLite + real embedder + real QuickJS per CLAUDE.md
 * §Testing Rules #5-6. Fixture wiki: auth.md, database.md, log.md.
 */

const FIXTURE_DIR = resolve(
  fileURLToPath(new URL('../fixtures/wiki', import.meta.url))
);

let bundle: DbBundle;
let repository: Repository;
let embedder: CountingEmbedder;
let executor: QuickJSExecutor;
let tmpRoot: string;

beforeAll(async () => {
  __resetSingleFlightForTests();

  tmpRoot = mkdtempSync(join(tmpdir(), 'kg-phase4-'));
  const wikiDir = join(tmpRoot, 'wiki');
  mkdirSync(wikiDir, { recursive: true });
  for (const name of readdirSync(FIXTURE_DIR)) {
    copyFileSync(join(FIXTURE_DIR, name), join(wikiDir, name));
  }

  bundle = openDb(join(tmpRoot, 'kg.db'));
  embedder = new CountingEmbedder(getDefaultEmbedder());
  await embedder.warmup();

  const ingester = new IngesterService(bundle, embedder, 'project', wikiDir);
  for (const name of readdirSync(wikiDir)) {
    if (name.endsWith('.md')) {
      await ingester.ingestFile(join(wikiDir, name));
    }
  }

  repository = new Repository(bundle);
  executor = new QuickJSExecutor();
  await executor.warmup();
}, 60_000);

afterAll(() => {
  executor?.dispose();
  if (bundle) closeDb(bundle);
  if (tmpRoot) rmSync(tmpRoot, { recursive: true, force: true });
  __resetSingleFlightForTests();
});

function parseResponse(response: { content: [{ type: 'text'; text: string }] }) {
  const text = response.content[0]?.text ?? '';
  return { text, envelope: JSON.parse(text) };
}

// ============================================================================
// FTS5 tests
// ============================================================================

describe('FTS5 retrieval', () => {
  it('BM25 ranking: "hashPassword" ranks auth.md chunks highest', () => {
    const reader = nextReader(bundle);
    const results = ftsQuery(reader, 'project', 'hashPassword', 10);
    expect(results.length).toBeGreaterThanOrEqual(1);
    // The top result should be from auth.md (source_uri contains "auth")
    expect(results[0].source_uri).toContain('auth');
  });

  it('snippet output is bounded and contains match context', () => {
    const reader = nextReader(bundle);
    const results = ftsQuery(reader, 'project', 'bcrypt', 5);
    expect(results.length).toBeGreaterThanOrEqual(1);
    // snippet should be present and non-empty
    expect(results[0].snippet).toBeTruthy();
    expect(typeof results[0].snippet).toBe('string');
  });

  it('empty query returns []', () => {
    const reader = nextReader(bundle);
    expect(ftsQuery(reader, 'project', '', 10)).toEqual([]);
    expect(ftsQuery(reader, 'project', '   ', 10)).toEqual([]);
  });

  it('escapeFts5Query wraps tokens in double quotes', () => {
    expect(escapeFts5Query('hello world')).toBe('"hello" "world"');
    expect(escapeFts5Query('  ')).toBeNull();
    // Quotes in tokens are escaped
    expect(escapeFts5Query('say "hi"')).toBe('"say" """hi"""');
  });
});

// ============================================================================
// Vector search tests
// ============================================================================

describe('vector retrieval', () => {
  it('vec distance ordering: closer semantic match ranks higher', async () => {
    const reader = nextReader(bundle);
    const queryEmbedding = await embedder.embed('password hashing bcrypt');
    const results = vecQuery(reader, 'project', queryEmbedding, 10);
    expect(results.length).toBeGreaterThanOrEqual(1);
    // Distance should be non-negative and sorted ascending (closest first)
    for (let i = 1; i < results.length; i++) {
      expect(results[i].distance).toBeGreaterThanOrEqual(results[i - 1].distance);
    }
    // Top result should be from auth.md (contains bcrypt references)
    expect(results[0].source_uri).toContain('auth');
  });

  it('vecSearch convenience wrapper embeds query then searches', async () => {
    const reader = nextReader(bundle);
    const results = await vecSearch(reader, 'project', 'WAL journal mode', embedder, 5);
    expect(results.length).toBeGreaterThanOrEqual(1);
    // Top result should be from database.md
    expect(results[0].source_uri).toContain('database');
  });

  it('graceful degradation: empty vec table returns []', () => {
    // Create a fresh DB with no vec rows
    const emptyRoot = mkdtempSync(join(tmpdir(), 'kg-vec-empty-'));
    const emptyBundle = openDb(join(emptyRoot, 'kg.db'));
    const reader = nextReader(emptyBundle);
    const fakeEmbedding = new Float32Array(384);
    const results = vecQuery(reader, 'project', fakeEmbedding, 10);
    expect(results).toEqual([]);
    closeDb(emptyBundle);
    rmSync(emptyRoot, { recursive: true, force: true });
  });
});

// ============================================================================
// Hybrid RRF tests
// ============================================================================

describe('hybrid RRF retrieval', () => {
  it('hybrid returns expected top-k on fixture queries', async () => {
    const reader = nextReader(bundle);
    const results = await hybridSearch(reader, 'project', 'bcrypt password', embedder, { limit: 5 });
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results.length).toBeLessThanOrEqual(5);
    // Top result should be auth.md
    expect(results[0].source_uri).toContain('auth');
    // Score should be positive
    expect(results[0].score).toBeGreaterThan(0);
  });

  it('RRF deduplication: chunk appearing in both FTS and vec is not doubled', () => {
    // Simulate a chunk appearing in both result lists
    const ftsResults = [
      { id: 'chunk-1', text: 'hello', snippet: 'hello...', source_uri: 'a.md', node_id: 'n1', rank: -5 },
      { id: 'chunk-2', text: 'world', snippet: 'world...', source_uri: 'b.md', node_id: 'n2', rank: -3 },
    ];
    const vecResults = [
      { id: 'chunk-1', text: 'hello', source_uri: 'a.md', node_id: 'n1', distance: 0.1 },
      { id: 'chunk-3', text: 'foo', source_uri: 'c.md', node_id: 'n3', distance: 0.5 },
    ];

    const merged = rrfFuse(ftsResults, vecResults, 60, 10);
    // chunk-1 appears in both lists — should appear only once in merged
    const ids = merged.map((r) => r.id);
    expect(ids.filter((id) => id === 'chunk-1').length).toBe(1);
    // chunk-1 should have highest score (appears in both lists)
    expect(merged[0].id).toBe('chunk-1');
    // Total unique items: chunk-1, chunk-2, chunk-3
    expect(merged.length).toBe(3);
  });

  it('RRF single-side: item in only FTS still appears with partial score', () => {
    const ftsResults = [
      { id: 'fts-only', text: 'fts hit', snippet: '...', source_uri: 'a.md', node_id: 'n1', rank: -5 },
    ];
    const vecResults = [
      { id: 'vec-only', text: 'vec hit', source_uri: 'b.md', node_id: 'n2', distance: 0.2 },
    ];

    const merged = rrfFuse(ftsResults, vecResults, 60, 10);
    expect(merged.length).toBe(2);
    // Both items should have positive scores
    expect(merged[0].score).toBeGreaterThan(0);
    expect(merged[1].score).toBeGreaterThan(0);
    // Scores should be equal since both are rank-1 in their respective lists
    expect(merged[0].score).toBeCloseTo(merged[1].score, 10);
  });
});

// ============================================================================
// Embedder factory tests
// ============================================================================

describe('embedder factory', () => {
  it('createEmbedder("transformers") returns TransformersEmbedder', () => {
    const e = createEmbedder('transformers');
    expect(e).toBeInstanceOf(TransformersEmbedder);
    expect(e.dim).toBe(384);
  });

  it('createEmbedder() defaults to TransformersEmbedder', () => {
    const e = createEmbedder();
    expect(e).toBeInstanceOf(TransformersEmbedder);
  });

  it('createEmbedder("voyage") throws without API key', () => {
    // Ensure env var is not set
    const original = process.env['KG_VOYAGE_API_KEY'];
    delete process.env['KG_VOYAGE_API_KEY'];
    try {
      expect(() => createEmbedder('voyage')).toThrow('KG_VOYAGE_API_KEY');
    } finally {
      if (original) process.env['KG_VOYAGE_API_KEY'] = original;
    }
  });
});

// ============================================================================
// Budget gate adversarial tests
// ============================================================================

describe('budget gate adversarial (Phase 4)', () => {
  it('100K tokens of text truncated to <= max_tokens', () => {
    // Generate ~100K tokens worth of text items
    const items: Array<{ id: string; text: string; source_uri: string }> = [];
    for (let i = 0; i < 200; i++) {
      items.push({
        id: `chunk-${i}`,
        text: 'a '.repeat(500), // ~500 tokens each, 200 items = ~100K tokens
        source_uri: `file-${i}.md`,
      });
    }

    const maxTokens = 5000;
    const fit = fitResults(
      items,
      maxTokens,
      (item) => JSON.stringify(item),
      (item) => item.id,
      (item) => item.source_uri
    );

    // Total tokens used must be within budget
    const budget = computeInternalBudget(maxTokens);
    expect(fit.tokensUsed).toBeLessThanOrEqual(budget);
    expect(fit.truncated).toBe(true);
    // Some items should have been kept
    expect(fit.kept.length).toBeGreaterThan(0);
    expect(fit.kept.length).toBeLessThan(200);
  });

  it('10% safety margin: max_tokens=20000 → internal budget is 17550', () => {
    // floor((20000 - 500) * 0.9) = floor(17550) = 17550
    const budget = computeInternalBudget(20000);
    expect(budget).toBe(17550);
  });

  it('results_truncated flag is set when truncating', () => {
    const items = Array.from({ length: 50 }, (_, i) => ({
      id: `c-${i}`,
      text: 'word '.repeat(200),
      source_uri: 'big.md',
    }));

    const fit = fitResults(
      items,
      1000, // very small budget
      (item) => JSON.stringify(item),
      (item) => item.id,
      (item) => item.source_uri
    );

    expect(fit.truncated).toBe(true);
  });

  it('single 10K-token node emits too_large sentinel', () => {
    const bigItem = {
      id: 'huge-1',
      text: 'x '.repeat(10000),
      source_uri: 'huge.md',
    };

    const fit = fitResults(
      [bigItem],
      5000,
      (item) => JSON.stringify(item),
      (item) => item.id,
      (item) => item.source_uri
    );

    expect(fit.truncated).toBe(true);
    expect(fit.kept.length).toBe(1);
    expect(fit.kept[0]).toHaveProperty('too_large', true);
    expect((fit.kept[0] as { id: string }).id).toBe('huge-1');
  });

  it('1 huge + 99 small: huge gets sentinel, small items still fit', () => {
    const items = [
      { id: 'huge', text: 'x '.repeat(10000), source_uri: 'huge.md' },
      ...Array.from({ length: 99 }, (_, i) => ({
        id: `small-${i}`,
        text: 'hello world',
        source_uri: `small-${i}.md`,
      })),
    ];

    const fit = fitResults(
      items,
      5000,
      (item) => JSON.stringify(item),
      (item) => item.id,
      (item) => item.source_uri
    );

    expect(fit.truncated).toBe(true);
    // Huge item should be a sentinel
    const sentinel = fit.kept[0];
    expect(sentinel).toHaveProperty('too_large', true);
    // Small items should follow
    expect(fit.kept.length).toBeGreaterThan(1);
  });
});

// ============================================================================
// End-to-end kg_search hybrid test
// ============================================================================

describe('kg_search hybrid e2e', () => {
  it('ingest fixture wiki, call kg_search, get ranked results with scores', async () => {
    const handler = makeKgSearchHandler({ repository, embedder, bundle });
    const res = await handler({ query: 'bcrypt password hashing' });
    const { envelope } = parseResponse(res);
    expect(envelope.result.length).toBeGreaterThanOrEqual(1);
    // Result should have score field from hybrid ranking
    expect(envelope.result[0]).toHaveProperty('score');
    expect(envelope.result[0].score).toBeGreaterThan(0);
    // Top result should be auth-related
    expect(envelope.result[0].source_uri).toContain('auth');
  });
});

// ============================================================================
// Sandbox vec+hybrid test
// ============================================================================

describe('sandbox hybrid integration', () => {
  it('kg.project.hybrid("bcrypt") in sandbox returns FTS-ranked results', async () => {
    const handler = makeKgExecuteHandler({ repository, executor, bundle, embedder });
    const res = await handler({ code: "return kg.project.hybrid('bcrypt')" });
    const { envelope } = parseResponse(res);
    expect(envelope.result.length).toBeGreaterThanOrEqual(1);
    // Results should have RRF score
    const first = envelope.result[0] as { id: string; score: number; source_uri: string };
    expect(first.score).toBeGreaterThan(0);
    expect(first.source_uri).toContain('auth');
  });

  it('kg.project.fts("WAL") in sandbox returns database.md results with snippet', async () => {
    const handler = makeKgExecuteHandler({ repository, executor, bundle, embedder });
    const res = await handler({ code: "return kg.project.fts('WAL')" });
    const { envelope } = parseResponse(res);
    expect(envelope.result.length).toBeGreaterThanOrEqual(1);
    const first = envelope.result[0] as { source_uri: string; snippet: string };
    expect(first.source_uri).toContain('database');
    expect(first.snippet).toBeTruthy();
  });
});

// ============================================================================
// Ground truth fixture
// ============================================================================

describe('ground truth hit rate (Phase 4 exit gate)', () => {
  /**
   * Hand-labeled ground-truth queries. Each entry specifies a query and the
   * expected source file(s) that should appear in the top-3 results. The
   * Phase 4 gate requires >= 70% hit rate.
   */
  const groundTruth = [
    { query: 'hashPassword', expectedFiles: ['auth'] },
    { query: 'bcrypt cost factor', expectedFiles: ['auth'] },
    { query: 'WAL mode', expectedFiles: ['database'] },
    { query: 'session revocation', expectedFiles: ['auth'] },
    { query: 'password reset token', expectedFiles: ['auth'] },
    { query: 'better-sqlite3 writer', expectedFiles: ['database'] },
    { query: 'JWT login', expectedFiles: ['auth'] },
    { query: 'schema ownership', expectedFiles: ['database'] },
    { query: 'personal scope privacy', expectedFiles: ['database'] },
    { query: 'connection strategy', expectedFiles: ['database'] },
  ];

  it(`>= 70% hit rate on ${groundTruth.length} ground truth queries`, async () => {
    const reader = nextReader(bundle);
    let hits = 0;

    for (const { query, expectedFiles } of groundTruth) {
      const results = await hybridSearch(reader, 'project', query, embedder, { limit: 3 });
      const topUris = results.slice(0, 3).map((r) => r.source_uri);
      const matched = expectedFiles.some((expected) =>
        topUris.some((uri) => uri.includes(expected))
      );
      if (matched) hits++;
    }

    const hitRate = hits / groundTruth.length;
    console.error(`[ground truth] hit rate: ${hits}/${groundTruth.length} = ${(hitRate * 100).toFixed(0)}%`);
    expect(hitRate).toBeGreaterThanOrEqual(0.7);
  });
});
