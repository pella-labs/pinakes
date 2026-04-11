import { afterAll, describe, it, expect, beforeAll } from 'vitest';
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { closeDb, openDb, nextReader, type DbBundle } from '../db/client.js';
import { IngesterService, __resetSingleFlightForTests } from '../ingest/ingester.js';
import { listMarkdownFiles } from '../ingest/manifest.js';
import { CountingEmbedder, getDefaultEmbedder } from '../retrieval/embedder.js';
import { hybridSearch } from '../retrieval/hybrid.js';
import { ftsQuery } from '../retrieval/fts.js';
import { vecSearch } from '../retrieval/vec.js';

/**
 * Ablation study: FTS-only vs Vec-only vs Hybrid.
 *
 * Answers: is the bottleneck the embedding model or the FTS tokenizer?
 * If vec-only is much worse than FTS-only, a better model helps.
 * If vec-only is already better than FTS-only, the model is fine.
 */

const __dirname = resolve(fileURLToPath(import.meta.url), '..');
const WIKI_1000 = resolve(__dirname, 'fixtures/wiki-1000');

interface GoldenEntry {
  query: string;
  expectedFiles: string[];
}

// Reuse 40 exact-match queries from the golden set (skip cross-domain/natural-lang)
const QUERIES: GoldenEntry[] = [
  { query: 'microservices bounded context scalability', expectedFiles: ['arch-001'] },
  { query: 'modular monolith module boundaries', expectedFiles: ['arch-025'] },
  { query: 'chain of responsibility middleware handler', expectedFiles: ['arch-050'] },
  { query: 'database per service polyglot persistence', expectedFiles: ['arch-075'] },
  { query: 'microservices gRPC service mesh communication', expectedFiles: ['arch-100'] },
  { query: 'REST resource naming kebab-case plural', expectedFiles: ['api-001'] },
  { query: 'API gateway BFF pattern north-south', expectedFiles: ['api-025'] },
  { query: 'API contract testing Pact', expectedFiles: ['api-050'] },
  { query: 'content-type vendor media type negotiation', expectedFiles: ['api-075'] },
  { query: 'Kong API gateway declarative Lua plugin', expectedFiles: ['api-100'] },
  { query: 'PostgreSQL MVCC write-ahead log', expectedFiles: ['db-001'] },
  { query: 'ETL pipeline dbt DAG orchestration', expectedFiles: ['db-025'] },
  { query: 'stored procedures PL/pgSQL functions', expectedFiles: ['db-050'] },
  { query: 'multi-tenant row level security schema separation', expectedFiles: ['db-075'] },
  { query: 'data warehouse star schema bronze silver gold', expectedFiles: ['db-100'] },
  { query: 'OAuth2 PKCE refresh token authorization', expectedFiles: ['sec-001'] },
  { query: 'envelope encryption TDE at rest', expectedFiles: ['sec-025'] },
  { query: 'security code review IDOR Argon2id', expectedFiles: ['sec-050'] },
  { query: 'browser storage HttpOnly localStorage XSS', expectedFiles: ['sec-075'] },
  { query: 'RASP runtime application self-protection WAF', expectedFiles: ['sec-100'] },
  { query: 'CI/CD trunk-based DORA metrics deployment frequency', expectedFiles: ['ops-001'] },
  { query: 'container registry ECR lifecycle tagging', expectedFiles: ['ops-025'] },
  { query: 'SLO error budget burn rate 99.9 availability', expectedFiles: ['ops-050'] },
  { query: 'Kubernetes CRD operator OpenAPI schema', expectedFiles: ['ops-075'] },
  { query: 'Terraform locals for expressions string templates', expectedFiles: ['ops-100'] },
  { query: 'React compound components composition', expectedFiles: ['fe-001'] },
  { query: 'Framer Motion CSS animation transitions', expectedFiles: ['fe-025'] },
  { query: 'XState state machine UI logic', expectedFiles: ['fe-050'] },
  { query: 'CSS container queries cqw units', expectedFiles: ['fe-075'] },
  { query: 'frontend monorepo Turborepo remote caching', expectedFiles: ['fe-100'] },
  { query: 'unit testing AAA pattern isolation', expectedFiles: ['test-001'] },
  { query: 'testing async fake timers race conditions', expectedFiles: ['test-025'] },
  { query: 'mock third-party nock MSW integration', expectedFiles: ['test-050'] },
  { query: 'testing polymorphic Liskov substitution', expectedFiles: ['test-075'] },
  { query: 'type safety expectTypeOf runtime validation', expectedFiles: ['test-100'] },
  { query: 'cache invalidation TTL stampede', expectedFiles: ['perf-001'] },
  { query: 'capacity planning load testing auto-scaling', expectedFiles: ['perf-025'] },
  { query: 'TCP BBR congestion Nagle keep-alive', expectedFiles: ['perf-050'] },
  { query: 'Kubernetes CPU throttling OOM memory limits', expectedFiles: ['perf-075'] },
  { query: 'observability maturity RED method distributed tracing', expectedFiles: ['perf-100'] },
];

function hitRate(
  results: Map<string, string[]>,
  queries: GoldenEntry[],
  k: number
): { rate: number; hits: number; total: number; mrr: number } {
  let hits = 0;
  let rrSum = 0;
  for (const entry of queries) {
    const topK = (results.get(entry.query) ?? []).slice(0, k);
    const idx = topK.findIndex((uri) =>
      entry.expectedFiles.some((f) => uri === `${f}.md` || uri.includes(`/${f}.md`))
    );
    if (idx >= 0) {
      hits++;
      rrSum += 1 / (idx + 1);
    }
  }
  return {
    rate: hits / queries.length,
    hits,
    total: queries.length,
    mrr: rrSum / queries.length,
  };
}

describe('retrieval ablation: wiki-1000', () => {
  let tmp: string;
  let bundle: DbBundle;
  let embedder: CountingEmbedder;

  let ftsResults: Map<string, string[]>;
  let vecResults: Map<string, string[]>;
  let hybridResults: Map<string, string[]>;

  beforeAll(async () => {
    __resetSingleFlightForTests();
    tmp = mkdtempSync(join(tmpdir(), 'pinakes-ablation-'));
    const tmpWiki = join(tmp, 'wiki');
    cpSync(WIKI_1000, tmpWiki, { recursive: true });

    embedder = new CountingEmbedder(getDefaultEmbedder());
    await embedder.warmup();

    bundle = openDb(join(tmp, 'pinakes.db'));
    const ingester = new IngesterService(bundle, embedder, 'project', tmpWiki);
    for (const file of listMarkdownFiles(tmpWiki)) {
      await ingester.ingestFile(file);
    }

    const reader = nextReader(bundle);

    // Run all three search modes
    ftsResults = new Map();
    vecResults = new Map();
    hybridResults = new Map();

    for (const entry of QUERIES) {
      // FTS only — fetch 20 for @10/@20 metrics
      const fts = ftsQuery(reader, 'project', entry.query, 20);
      ftsResults.set(entry.query, fts.map((r) => r.source_uri));

      // Vec only
      const vec = await vecSearch(reader, 'project', entry.query, embedder, 20);
      vecResults.set(entry.query, vec.map((r) => r.source_uri));

      // Hybrid (FTS + Vec fused via RRF)
      const hyb = await hybridSearch(reader, 'project', entry.query, embedder, { limit: 20 });
      hybridResults.set(entry.query, hyb.map((r) => r.source_uri));
    }
  }, 900_000);

  afterAll(() => {
    if (bundle) closeDb(bundle);
    if (tmp) rmSync(tmp, { recursive: true, force: true });
    __resetSingleFlightForTests();
  });

  for (const k of [1, 3, 5, 10, 20]) {
    it(`FTS-only hit rate @${k}`, () => {
      const m = hitRate(ftsResults, QUERIES, k);
      console.error(
        `[ablation] FTS-only  @${k}: ${m.hits}/${m.total} = ${(m.rate * 100).toFixed(1)}%  MRR=${m.mrr.toFixed(3)}`
      );
    });

    it(`Vec-only hit rate @${k}`, () => {
      const m = hitRate(vecResults, QUERIES, k);
      console.error(
        `[ablation] Vec-only  @${k}: ${m.hits}/${m.total} = ${(m.rate * 100).toFixed(1)}%  MRR=${m.mrr.toFixed(3)}`
      );
    });

    it(`Hybrid hit rate @${k}`, () => {
      const m = hitRate(hybridResults, QUERIES, k);
      console.error(
        `[ablation] Hybrid    @${k}: ${m.hits}/${m.total} = ${(m.rate * 100).toFixed(1)}%  MRR=${m.mrr.toFixed(3)}`
      );
    });
  }

  it('summary: print comparison table', () => {
    const table: string[] = ['\n[ablation] Retrieval comparison (40 queries, wiki-1000, 6051 chunks):'];
    table.push('  Method      @1 hit%   @3 hit%   @5 hit%   @10 hit%  @20 hit%  MRR@5');
    table.push('  ─────────   ───────   ───────   ───────   ────────  ────────  ─────');
    for (const [label, results] of [
      ['FTS-only', ftsResults],
      ['Vec-only', vecResults],
      ['Hybrid  ', hybridResults],
    ] as const) {
      const m1 = hitRate(results, QUERIES, 1);
      const m3 = hitRate(results, QUERIES, 3);
      const m5 = hitRate(results, QUERIES, 5);
      const m10 = hitRate(results, QUERIES, 10);
      const m20 = hitRate(results, QUERIES, 20);
      table.push(
        `  ${label}   ${(m1.rate * 100).toFixed(1).padStart(5)}%   ` +
        `${(m3.rate * 100).toFixed(1).padStart(5)}%   ` +
        `${(m5.rate * 100).toFixed(1).padStart(5)}%   ` +
        `${(m10.rate * 100).toFixed(1).padStart(5)}%    ` +
        `${(m20.rate * 100).toFixed(1).padStart(5)}%    ${m5.mrr.toFixed(3)}`
      );
    }
    console.error(table.join('\n'));
  });

  it('hybrid @20 recall >= vec @20 recall (FTS adds coverage)', () => {
    const hybM = hitRate(hybridResults, QUERIES, 20);
    const vecM = hitRate(vecResults, QUERIES, 20);
    console.error(
      `[ablation] Hybrid@20: ${(hybM.rate * 100).toFixed(1)}% vs Vec@20: ${(vecM.rate * 100).toFixed(1)}%`
    );
    expect(hybM.rate).toBeGreaterThanOrEqual(vecM.rate);
  });
});
