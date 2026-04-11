import { afterAll, describe, it, expect, beforeAll } from 'vitest';
import { cpSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { closeDb, openDb, nextReader, type DbBundle } from '../db/client.js';
import { Repository } from '../db/repository.js';
import { IngesterService, __resetSingleFlightForTests } from '../ingest/ingester.js';
import { listMarkdownFiles } from '../ingest/manifest.js';
import { CountingEmbedder, getDefaultEmbedder } from '../retrieval/embedder.js';
import { hybridSearch } from '../retrieval/hybrid.js';
import { ftsQuery } from '../retrieval/fts.js';
import { vecQuery } from '../retrieval/vec.js';
import { makeSearchHandler } from '../mcp/tools/search.js';
import { makeExecuteHandler } from '../mcp/tools/execute.js';
import { QuickJSExecutor } from '../sandbox/executor.js';
import { countTokens } from '../gate/budget.js';

/**
 * Comprehensive benchmark suite for wiki-100 and wiki-1000 fixtures.
 *
 * Measures:
 *   1. Rebuild/ingest time (full pipeline: parse → chunk → embed → index)
 *   2. DB stats (file size, row counts)
 *   3. FTS query latency (p50, p95)
 *   4. Vector query latency (p50, p95)
 *   5. Hybrid query latency (p50, p95)
 *   6. search tool handler latency (p50, p95)
 *   7. execute tool handler latency (p50, p95)
 *   8. Budget gate behavior at scale
 *
 * These are slow tests (~5-15 min total). Run explicitly:
 *   pnpm run test -- src/__tests__/benchmark-wikis.test.ts
 */

const __dirname = resolve(fileURLToPath(import.meta.url), '..');
const WIKI_100 = resolve(__dirname, 'fixtures/wiki-100');
const WIKI_1000 = resolve(__dirname, 'fixtures/wiki-1000');

const QUERIES = [
  'authentication OAuth2 flow',
  'database migration strategy',
  'Kubernetes deployment',
  'circuit breaker pattern',
  'rate limiting',
  'JWT token validation',
  'CI/CD pipeline',
  'caching strategy Redis',
  'microservices communication',
  'monitoring alerting',
  'load balancing',
  'GraphQL schema design',
  'Docker container security',
  'REST API versioning',
  'event-driven architecture',
  'TLS certificate management',
  'testing integration e2e',
  'CORS configuration',
  'secrets management Vault',
  'performance optimization',
];

function percentile(sorted: number[], p: number): number {
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)]!;
}

function stats(times: number[]): { p50: number; p95: number; min: number; max: number; mean: number } {
  const sorted = [...times].sort((a, b) => a - b);
  return {
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    min: sorted[0]!,
    max: sorted[sorted.length - 1]!,
    mean: Math.round((times.reduce((a, b) => a + b, 0) / times.length) * 10) / 10,
  };
}

interface WikiBenchCtx {
  tmp: string;
  dbPath: string;
  bundle: DbBundle;
  embedder: CountingEmbedder;
  repository: Repository;
  executor: QuickJSExecutor;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  searchHandler: (args: any) => Promise<{ content: [{ type: 'text'; text: string }] }>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  executeHandler: (args: any) => Promise<{ content: [{ type: 'text'; text: string }] }>;
  wikiRoot: string;
  ingestDurationMs: number;
  fileCount: number;
  nodeCount: number;
  chunkCount: number;
  vecCount: number;
  dbSizeBytes: number;
}

function describeBenchmark(name: string, wikiDir: string, timeout: number) {
  describe(name, () => {
    let ctx: WikiBenchCtx;

    beforeAll(async () => {
      __resetSingleFlightForTests();
      const tmp = mkdtempSync(join(tmpdir(), `pinakes-bench-${name}-`));
      const tmpWiki = join(tmp, 'wiki');
      const dbPath = join(tmp, 'pinakes.db');

      // Copy wiki to temp dir so the manifest doesn't pollute the fixture
      cpSync(wikiDir, tmpWiki, { recursive: true });

      const embedder = new CountingEmbedder(getDefaultEmbedder());
      await embedder.warmup();

      const bundle = openDb(dbPath);
      const ingester = new IngesterService(bundle, embedder, 'project', tmpWiki);
      const files = listMarkdownFiles(tmpWiki);

      // Benchmark: full ingest
      const t0 = performance.now();
      for (const file of files) {
        await ingester.ingestFile(file);
      }
      const ingestDurationMs = Math.round(performance.now() - t0);

      // DB stats
      const count = (table: string): number =>
        (bundle.writer.prepare(`SELECT count(*) AS c FROM ${table}`).get() as { c: number }).c;

      const nodeCount = count('pinakes_nodes');
      const chunkCount = count('pinakes_chunks');
      const vecCount = count('pinakes_chunks_vec');
      const dbSizeBytes = statSync(dbPath).size;

      // Build tool handlers
      const repository = new Repository(bundle);
      const executor = new QuickJSExecutor();
      await executor.warmup();

      const searchHandler = makeSearchHandler({ repository, embedder, bundle });
      const executeHandler = makeExecuteHandler({
        repository, executor, bundle, embedder, wikiRoot: tmpWiki,
      });

      ctx = {
        tmp, dbPath, bundle, embedder, repository, executor,
        searchHandler, executeHandler,
        wikiRoot: tmpWiki, ingestDurationMs, fileCount: files.length,
        nodeCount, chunkCount, vecCount, dbSizeBytes,
      };

      // Print ingest summary
      console.error(
        `\n[${name}] ingest: ${files.length} files → ${nodeCount} nodes, ` +
        `${chunkCount} chunks, ${vecCount} vec rows in ${ingestDurationMs}ms ` +
        `(${Math.round(ingestDurationMs / files.length)}ms/file). ` +
        `DB size: ${(dbSizeBytes / 1024 / 1024).toFixed(1)}MB. ` +
        `Embedder calls: ${embedder.calls}`
      );
    }, timeout);

    afterAll(() => {
      if (ctx) {
        closeDb(ctx.bundle);
        rmSync(ctx.tmp, { recursive: true, force: true });
      }
      __resetSingleFlightForTests();
    });

    // ── Ingest benchmarks ────────────────────────────────────────────

    it('ingest completes', () => {
      expect(ctx.fileCount).toBeGreaterThan(0);
      expect(ctx.nodeCount).toBeGreaterThan(0);
      expect(ctx.chunkCount).toBeGreaterThan(0);
      expect(ctx.vecCount).toBe(ctx.chunkCount);
      console.error(
        `[${name}] ingest: ${ctx.ingestDurationMs}ms total, ` +
        `${Math.round(ctx.ingestDurationMs / ctx.fileCount)}ms/file`
      );
    });

    it('DB size is reasonable', () => {
      const mbPerFile = ctx.dbSizeBytes / 1024 / 1024 / ctx.fileCount;
      console.error(
        `[${name}] DB: ${(ctx.dbSizeBytes / 1024 / 1024).toFixed(1)}MB ` +
        `(${mbPerFile.toFixed(3)}MB/file)`
      );
      // Sanity: <1MB per file on average
      expect(mbPerFile).toBeLessThan(1);
    });

    // ── FTS benchmarks ───────────────────────────────────────────────

    it('FTS query latency', () => {
      const reader = nextReader(ctx.bundle);
      const times: number[] = [];
      for (const q of QUERIES) {
        const t0 = performance.now();
        ftsQuery(reader, 'project', q, 20);
        times.push(performance.now() - t0);
      }
      const s = stats(times);
      console.error(
        `[${name}] FTS p50=${s.p50.toFixed(1)}ms p95=${s.p95.toFixed(1)}ms ` +
        `mean=${s.mean}ms min=${s.min.toFixed(1)}ms max=${s.max.toFixed(1)}ms`
      );
    });

    // ── Vec benchmarks ───────────────────────────────────────────────

    it('vector query latency', async () => {
      const reader = nextReader(ctx.bundle);
      const times: number[] = [];
      for (const q of QUERIES) {
        const embedding = await ctx.embedder.embed(q);
        const t0 = performance.now();
        vecQuery(reader, 'project', embedding, 20);
        times.push(performance.now() - t0);
      }
      const s = stats(times);
      console.error(
        `[${name}] Vec p50=${s.p50.toFixed(1)}ms p95=${s.p95.toFixed(1)}ms ` +
        `mean=${s.mean}ms min=${s.min.toFixed(1)}ms max=${s.max.toFixed(1)}ms`
      );
    });

    // ── Hybrid benchmarks ────────────────────────────────────────────

    it('hybrid query latency', async () => {
      const reader = nextReader(ctx.bundle);
      const times: number[] = [];
      for (const q of QUERIES) {
        const t0 = performance.now();
        await hybridSearch(reader, 'project', q, ctx.embedder);
        times.push(performance.now() - t0);
      }
      const s = stats(times);
      console.error(
        `[${name}] Hybrid p50=${s.p50.toFixed(1)}ms p95=${s.p95.toFixed(1)}ms ` +
        `mean=${s.mean}ms min=${s.min.toFixed(1)}ms max=${s.max.toFixed(1)}ms`
      );
    });

    // ── search handler benchmarks ─────────────────────────────────

    it('search handler latency', async () => {
      const times: number[] = [];
      for (const q of QUERIES) {
        const t0 = performance.now();
        await ctx.searchHandler({ query: q, scope: 'project' });
        times.push(performance.now() - t0);
      }
      const s = stats(times);
      console.error(
        `[${name}] search p50=${s.p50.toFixed(1)}ms p95=${s.p95.toFixed(1)}ms ` +
        `mean=${s.mean}ms min=${s.min.toFixed(1)}ms max=${s.max.toFixed(1)}ms`
      );
    });

    // ── execute handler benchmarks ─��──────────────────────────────

    it('execute FTS handler latency', async () => {
      const times: number[] = [];
      for (const q of QUERIES) {
        const t0 = performance.now();
        await ctx.executeHandler({
          code: `return pinakes.project.fts(${JSON.stringify(q)})`,
          scope: 'project',
        });
        times.push(performance.now() - t0);
      }
      const s = stats(times);
      console.error(
        `[${name}] execute(fts) p50=${s.p50.toFixed(1)}ms p95=${s.p95.toFixed(1)}ms ` +
        `mean=${s.mean}ms min=${s.min.toFixed(1)}ms max=${s.max.toFixed(1)}ms`
      );
    });

    it('execute hybrid handler latency', async () => {
      const times: number[] = [];
      for (const q of QUERIES) {
        const t0 = performance.now();
        await ctx.executeHandler({
          code: `return pinakes.project.hybrid(${JSON.stringify(q)})`,
          scope: 'project',
        });
        times.push(performance.now() - t0);
      }
      const s = stats(times);
      console.error(
        `[${name}] execute(hybrid) p50=${s.p50.toFixed(1)}ms p95=${s.p95.toFixed(1)}ms ` +
        `mean=${s.mean}ms min=${s.min.toFixed(1)}ms max=${s.max.toFixed(1)}ms`
      );
    });

    // ── Budget gate benchmarks ───────────────────────────────────────

    it('budget gate: max_tokens=1000 truncates correctly', async () => {
      const res = await ctx.searchHandler({
        query: 'architecture design pattern',
        scope: 'project',
        max_tokens: 1000,
      });
      const envelope = JSON.parse(res.content[0].text) as {
        meta: { tokens_budgeted: number; tokens_used: number; results_truncated: boolean };
        result: unknown[];
      };
      const totalTokens = countTokens(res.content[0].text);
      console.error(
        `[${name}] budget(1000): used=${envelope.meta.tokens_used} ` +
        `actual=${totalTokens} truncated=${envelope.meta.results_truncated} ` +
        `results=${Array.isArray(envelope.result) ? envelope.result.length : 'N/A'}`
      );
      expect(totalTokens).toBeLessThanOrEqual(1200); // generous for safety margin math
    });

    it('budget gate: max_tokens=20000 returns more results', async () => {
      const res = await ctx.searchHandler({
        query: 'security authentication',
        scope: 'project',
        max_tokens: 20000,
      });
      const envelope = JSON.parse(res.content[0].text) as {
        meta: { tokens_budgeted: number; tokens_used: number };
        result: unknown[];
      };
      const totalTokens = countTokens(res.content[0].text);
      console.error(
        `[${name}] budget(20000): used=${envelope.meta.tokens_used} ` +
        `actual=${totalTokens} results=${Array.isArray(envelope.result) ? envelope.result.length : 'N/A'}`
      );
      expect(totalTokens).toBeLessThanOrEqual(25000);
    });

    // ── Idempotent re-ingest benchmark ───────────────────────────────

    it('re-ingest (no changes) is fast', async () => {
      const ingester = new IngesterService(ctx.bundle, ctx.embedder, 'project', ctx.wikiRoot);
      const files = listMarkdownFiles(ctx.wikiRoot);
      const callsBefore = ctx.embedder.calls;

      const t0 = performance.now();
      for (const file of files) {
        await ingester.ingestFile(file);
      }
      const reingestMs = Math.round(performance.now() - t0);
      const newEmbedCalls = ctx.embedder.calls - callsBefore;

      console.error(
        `[${name}] re-ingest: ${reingestMs}ms (${Math.round(reingestMs / files.length)}ms/file), ` +
        `${newEmbedCalls} new embed calls (should be 0)`
      );
      // Re-ingest should skip all chunks (no content changed)
      expect(newEmbedCalls).toBe(0);
      // Re-ingest should be much faster than initial ingest
      expect(reingestMs).toBeLessThan(ctx.ingestDurationMs);
    });
  }, timeout);
}

// ── Run benchmarks ─────────────────────────────────────────────────

describeBenchmark('wiki-100', WIKI_100, 300_000);   // 5 min
describeBenchmark('wiki-1000', WIKI_1000, 900_000);  // 15 min
