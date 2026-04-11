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

/**
 * Golden-set retrieval accuracy evaluation.
 *
 * Each entry: { query, expectedFiles, k }
 *   - query: the search string
 *   - expectedFiles: filename stems that MUST appear in top-k results
 *   - k: how many results to check (default 5)
 *
 * Metrics reported:
 *   - Hit rate: % of queries where at least one expected file is in top-k
 *   - Precision@k: avg fraction of top-k results that are expected
 *   - MRR: Mean Reciprocal Rank of the first expected result
 *
 * Run: pnpm run test -- src/__tests__/golden-sets.test.ts
 */

const __dirname = resolve(fileURLToPath(import.meta.url), '..');
const WIKI_100 = resolve(__dirname, 'fixtures/wiki-100');
const WIKI_1000 = resolve(__dirname, 'fixtures/wiki-1000');

interface GoldenEntry {
  query: string;
  /** File stems (without .md) that should appear in top-k */
  expectedFiles: string[];
  /** How many results to inspect (default 5) */
  k?: number;
}

// ============================================================================
// wiki-100 golden set (30 queries)
// ============================================================================

const GOLDEN_100: GoldenEntry[] = [
  // ── Architecture (exact concept matches) ──
  { query: 'microservices bounded context', expectedFiles: ['arch-001', 'arch-004'] },
  { query: 'event-driven architecture domain events', expectedFiles: ['arch-002'] },
  { query: 'hexagonal ports and adapters', expectedFiles: ['arch-003'] },
  { query: 'CQRS command query segregation', expectedFiles: ['arch-005'] },
  { query: 'circuit breaker half-open state', expectedFiles: ['arch-008'] },
  { query: 'saga compensating transactions', expectedFiles: ['arch-010'] },
  { query: 'service mesh sidecar proxy', expectedFiles: ['arch-006'] },
  { query: 'clean architecture use cases entities', expectedFiles: ['arch-009'] },
  { query: 'API gateway request routing', expectedFiles: ['arch-007'] },
  { query: 'strangler fig migration', expectedFiles: ['arch-011'] },

  // ── API & Backend (specific terms) ──
  { query: 'REST API versioning sunset policy', expectedFiles: ['api-001'] },
  { query: 'token bucket rate limiting', expectedFiles: ['api-002'] },
  { query: 'GraphQL DataLoader N+1', expectedFiles: ['api-003'] },
  { query: 'database connection pool sizing', expectedFiles: ['api-004'] },
  { query: 'gRPC Protocol Buffers streaming', expectedFiles: ['api-005'] },
  { query: 'cursor-based pagination', expectedFiles: ['api-006'] },
  { query: 'database B-Tree index strategy', expectedFiles: ['api-007'] },
  { query: 'HTTP caching ETag Cache-Control', expectedFiles: ['api-008'] },
  { query: 'database migration forward-only', expectedFiles: ['api-009'] },
  { query: 'ORM data mapper active record Drizzle', expectedFiles: ['api-010'] },

  // ── Security (precise matches) ──
  { query: 'OAuth2 PKCE authorization code', expectedFiles: ['sec-001'] },
  { query: 'JWT RS256 claims validation', expectedFiles: ['sec-002'] },
  { query: 'RBAC role inheritance permissions', expectedFiles: ['sec-003'] },
  { query: 'ABAC attribute-based policy', expectedFiles: ['sec-004'] },
  { query: 'mutual TLS SPIFFE certificates', expectedFiles: ['sec-005'] },

  // ── DevOps (operational topics) ──
  { query: 'CI/CD GitHub Actions pipeline', expectedFiles: ['ops-001'] },
  { query: 'Docker multi-stage build layer caching', expectedFiles: ['ops-002'] },
  { query: 'Kubernetes pod disruption budget EKS', expectedFiles: ['ops-003'] },
  { query: 'Terraform modules state locking', expectedFiles: ['ops-004'] },
  { query: 'Helm chart values semantic versioning', expectedFiles: ['ops-005'] },
];

// ============================================================================
// wiki-1000 golden set (50 queries)
// ============================================================================

const GOLDEN_1000: GoldenEntry[] = [
  // ── Architecture ──
  { query: 'microservices bounded context scalability', expectedFiles: ['arch-001'] },
  { query: 'modular monolith module boundaries', expectedFiles: ['arch-025'] },
  { query: 'chain of responsibility middleware handler', expectedFiles: ['arch-050'] },
  { query: 'database per service polyglot persistence', expectedFiles: ['arch-075'] },
  { query: 'microservices gRPC service mesh communication', expectedFiles: ['arch-100'] },

  // ── API ──
  { query: 'REST resource naming kebab-case plural', expectedFiles: ['api-001'] },
  { query: 'API gateway BFF pattern north-south', expectedFiles: ['api-025'] },
  { query: 'API contract testing Pact', expectedFiles: ['api-050'] },
  { query: 'content-type vendor media type negotiation', expectedFiles: ['api-075'] },
  { query: 'Kong API gateway declarative Lua plugin', expectedFiles: ['api-100'] },

  // ── Database ──
  { query: 'PostgreSQL MVCC write-ahead log', expectedFiles: ['db-001'] },
  { query: 'ETL pipeline dbt DAG orchestration', expectedFiles: ['db-025'] },
  { query: 'stored procedures PL/pgSQL functions', expectedFiles: ['db-050'] },
  { query: 'multi-tenant row level security schema separation', expectedFiles: ['db-075'] },
  { query: 'data warehouse star schema bronze silver gold', expectedFiles: ['db-100'] },

  // ── Security ──
  { query: 'OAuth2 PKCE refresh token authorization', expectedFiles: ['sec-001'] },
  { query: 'envelope encryption TDE at rest', expectedFiles: ['sec-025'] },
  { query: 'security code review IDOR Argon2id', expectedFiles: ['sec-050'] },
  { query: 'browser storage HttpOnly localStorage XSS', expectedFiles: ['sec-075'] },
  { query: 'RASP runtime application self-protection WAF', expectedFiles: ['sec-100'] },

  // ── DevOps ──
  { query: 'CI/CD trunk-based DORA metrics deployment frequency', expectedFiles: ['ops-001'] },
  { query: 'container registry ECR lifecycle tagging', expectedFiles: ['ops-025'] },
  { query: 'SLO error budget burn rate 99.9 availability', expectedFiles: ['ops-050'] },
  { query: 'Kubernetes CRD operator OpenAPI schema', expectedFiles: ['ops-075'] },
  { query: 'Terraform locals for expressions string templates', expectedFiles: ['ops-100'] },

  // ── Frontend ──
  { query: 'React compound components composition', expectedFiles: ['fe-001'] },
  { query: 'Framer Motion CSS animation transitions', expectedFiles: ['fe-025'] },
  { query: 'XState state machine UI logic', expectedFiles: ['fe-050'] },
  { query: 'CSS container queries cqw units', expectedFiles: ['fe-075'] },
  { query: 'frontend monorepo Turborepo remote caching', expectedFiles: ['fe-100'] },

  // ── Testing ──
  { query: 'unit testing AAA pattern isolation', expectedFiles: ['test-001'] },
  { query: 'testing async fake timers race conditions', expectedFiles: ['test-025'] },
  { query: 'mock third-party nock MSW integration', expectedFiles: ['test-050'] },
  { query: 'testing polymorphic Liskov substitution', expectedFiles: ['test-075'] },
  { query: 'type safety expectTypeOf runtime validation', expectedFiles: ['test-100'] },

  // ── Performance ──
  { query: 'cache invalidation TTL stampede', expectedFiles: ['perf-001'] },
  { query: 'capacity planning load testing auto-scaling', expectedFiles: ['perf-025'] },
  { query: 'TCP BBR congestion Nagle keep-alive', expectedFiles: ['perf-050'] },
  { query: 'Kubernetes CPU throttling OOM memory limits', expectedFiles: ['perf-075'] },
  { query: 'observability maturity RED method distributed tracing', expectedFiles: ['perf-100'] },

  // ── Cross-domain conceptual queries (broader expected matches) ──
  { query: 'how to handle authentication tokens securely', expectedFiles: ['sec-001', 'sec-002', 'sec-075'] },
  { query: 'database performance optimization indexing', expectedFiles: ['db-001', 'db-018', 'perf-007'] },
  { query: 'Kubernetes deployment scaling strategy', expectedFiles: ['ops-001', 'ops-075', 'ops-050'] },
  { query: 'testing API endpoints integration', expectedFiles: ['api-050', 'test-001', 'test-050'] },
  { query: 'monitoring alerting SLO observability', expectedFiles: ['ops-050', 'ops-019', 'perf-100', 'perf-015'] },

  // ── Fuzzy / natural-language queries (accept broader matches) ──
  { query: 'how do I set up a CI pipeline', expectedFiles: ['ops-001', 'ops-025'] },
  { query: 'what is the best caching strategy', expectedFiles: ['perf-001', 'perf-047', 'perf-082', 'arch-088', 'api-040'] },
  { query: 'how to prevent SQL injection attacks', expectedFiles: ['sec-050', 'sec-011', 'db-039'] },
  { query: 'React state management best practices', expectedFiles: ['fe-001', 'fe-002', 'fe-050', 'fe-110'] },
  { query: 'how to design a REST API', expectedFiles: ['api-001', 'api-025'] },
];

// ============================================================================
// Test infrastructure
// ============================================================================

interface EvalMetrics {
  hitRate: number;
  mrr: number;
  precisionAtK: number;
  hits: number;
  total: number;
  failures: { query: string; expected: string[]; got: string[] }[];
}

function evaluateGoldenSet(
  results: Map<string, string[]>,
  goldenSet: GoldenEntry[]
): EvalMetrics {
  let hits = 0;
  let rrSum = 0;
  let precSum = 0;
  const failures: EvalMetrics['failures'] = [];

  for (const entry of goldenSet) {
    const k = entry.k ?? 5;
    const topK = (results.get(entry.query) ?? []).slice(0, k);

    // Hit: at least one expected file in top-k
    const matchedIdx = topK.findIndex((uri) =>
      entry.expectedFiles.some((f) => uri === `${f}.md` || uri.includes(`/${f}.md`))
    );
    const isHit = matchedIdx >= 0;
    if (isHit) {
      hits++;
      rrSum += 1 / (matchedIdx + 1);
    } else {
      failures.push({
        query: entry.query,
        expected: entry.expectedFiles,
        got: topK.map((u) => u.replace(/\.md$/, '').split('/').pop() ?? u),
      });
    }

    // Precision@k: fraction of top-k that are expected
    const relevant = topK.filter((uri) =>
      entry.expectedFiles.some((f) => uri === `${f}.md` || uri.includes(`/${f}.md`))
    ).length;
    precSum += relevant / k;
  }

  return {
    hitRate: hits / goldenSet.length,
    mrr: rrSum / goldenSet.length,
    precisionAtK: precSum / goldenSet.length,
    hits,
    total: goldenSet.length,
    failures,
  };
}

function reportMetrics(name: string, m: EvalMetrics, k?: number): void {
  const kLabel = k ?? 5;
  console.error(
    `\n[${name}] Hit rate@${kLabel}: ${m.hits}/${m.total} = ${(m.hitRate * 100).toFixed(1)}%` +
    `  MRR: ${m.mrr.toFixed(3)}  Precision@${kLabel}: ${(m.precisionAtK * 100).toFixed(1)}%`
  );
  if (m.failures.length > 0) {
    console.error(`[${name}] Failures (${m.failures.length}):`);
    for (const f of m.failures.slice(0, 10)) {
      console.error(`  query="${f.query}" expected=[${f.expected}] got=[${f.got}]`);
    }
    if (m.failures.length > 10) {
      console.error(`  ... and ${m.failures.length - 10} more`);
    }
  }
}

// ============================================================================
// wiki-100 golden set evaluation
// ============================================================================

describe('golden-set: wiki-100', () => {
  let tmp: string;
  let bundle: DbBundle;
  let embedder: CountingEmbedder;
  let searchResults: Map<string, string[]>;

  beforeAll(async () => {
    __resetSingleFlightForTests();
    tmp = mkdtempSync(join(tmpdir(), 'pinakes-golden-100-'));
    const tmpWiki = join(tmp, 'wiki');
    cpSync(WIKI_100, tmpWiki, { recursive: true });

    embedder = new CountingEmbedder(getDefaultEmbedder());
    await embedder.warmup();

    bundle = openDb(join(tmp, 'pinakes.db'));
    const ingester = new IngesterService(bundle, embedder, 'project', tmpWiki);
    for (const file of listMarkdownFiles(tmpWiki)) {
      await ingester.ingestFile(file);
    }

    // Run all queries — fetch 20 results for @10/@20 evaluation
    searchResults = new Map();
    const reader = nextReader(bundle);
    for (const entry of GOLDEN_100) {
      const results = await hybridSearch(reader, 'project', entry.query, embedder, { limit: 20 });
      searchResults.set(entry.query, results.map((r) => r.source_uri));
    }
  }, 300_000);

  afterAll(() => {
    if (bundle) closeDb(bundle);
    if (tmp) rmSync(tmp, { recursive: true, force: true });
    __resetSingleFlightForTests();
  });

  it('hit rate @10 >= 80% (30 queries)', () => {
    const golden10 = GOLDEN_100.map((e) => ({ ...e, k: 10 }));
    const metrics = evaluateGoldenSet(searchResults, golden10);
    reportMetrics('wiki-100 @10', metrics, 10);
    expect(metrics.hitRate).toBeGreaterThanOrEqual(0.8);
  });

  it('hit rate @20 >= 90% (30 queries)', () => {
    const golden20 = GOLDEN_100.map((e) => ({ ...e, k: 20 }));
    const metrics = evaluateGoldenSet(searchResults, golden20);
    reportMetrics('wiki-100 @20', metrics, 20);
    expect(metrics.hitRate).toBeGreaterThanOrEqual(0.9);
  });

  it('MRR >= 0.5', () => {
    const metrics = evaluateGoldenSet(searchResults, GOLDEN_100);
    expect(metrics.mrr).toBeGreaterThanOrEqual(0.5);
  });

  // Individual category checks at @10
  it('architecture queries: >= 80% hit rate @10', () => {
    const archQueries = GOLDEN_100.filter((e) => e.expectedFiles.some((f) => f.startsWith('arch-'))).map((e) => ({ ...e, k: 10 }));
    const metrics = evaluateGoldenSet(searchResults, archQueries);
    reportMetrics('wiki-100/arch @10', metrics, 10);
    expect(metrics.hitRate).toBeGreaterThanOrEqual(0.8);
  });

  it('API queries: >= 80% hit rate @10', () => {
    const apiQueries = GOLDEN_100.filter((e) => e.expectedFiles.some((f) => f.startsWith('api-'))).map((e) => ({ ...e, k: 10 }));
    const metrics = evaluateGoldenSet(searchResults, apiQueries);
    reportMetrics('wiki-100/api @10', metrics, 10);
    expect(metrics.hitRate).toBeGreaterThanOrEqual(0.8);
  });

  it('security queries: >= 80% hit rate @10', () => {
    const secQueries = GOLDEN_100.filter((e) => e.expectedFiles.some((f) => f.startsWith('sec-'))).map((e) => ({ ...e, k: 10 }));
    const metrics = evaluateGoldenSet(searchResults, secQueries);
    reportMetrics('wiki-100/sec @10', metrics, 10);
    expect(metrics.hitRate).toBeGreaterThanOrEqual(0.8);
  });

  it('devops queries: >= 80% hit rate @10', () => {
    const opsQueries = GOLDEN_100.filter((e) => e.expectedFiles.some((f) => f.startsWith('ops-'))).map((e) => ({ ...e, k: 10 }));
    const metrics = evaluateGoldenSet(searchResults, opsQueries);
    reportMetrics('wiki-100/ops @10', metrics, 10);
    expect(metrics.hitRate).toBeGreaterThanOrEqual(0.8);
  });

  it('enriched metadata: results include title and section_path', async () => {
    const reader = nextReader(bundle);
    const results = await hybridSearch(reader, 'project', 'microservices bounded context', embedder, { limit: 5 });
    expect(results.length).toBeGreaterThanOrEqual(1);
    // Every result should have section_path (string) and title (string or null)
    for (const r of results) {
      expect(typeof r.section_path).toBe('string');
      expect(r.title === null || typeof r.title === 'string').toBe(true);
    }
    // At least one result should have a non-empty title
    expect(results.some((r) => r.title && r.title.length > 0)).toBe(true);
  });
});

// ============================================================================
// wiki-1000 golden set evaluation
// ============================================================================

describe('golden-set: wiki-1000', () => {
  let tmp: string;
  let bundle: DbBundle;
  let embedder: CountingEmbedder;
  let searchResults: Map<string, string[]>;

  beforeAll(async () => {
    __resetSingleFlightForTests();
    tmp = mkdtempSync(join(tmpdir(), 'pinakes-golden-1000-'));
    const tmpWiki = join(tmp, 'wiki');
    cpSync(WIKI_1000, tmpWiki, { recursive: true });

    embedder = new CountingEmbedder(getDefaultEmbedder());
    await embedder.warmup();

    bundle = openDb(join(tmp, 'pinakes.db'));
    const ingester = new IngesterService(bundle, embedder, 'project', tmpWiki);
    for (const file of listMarkdownFiles(tmpWiki)) {
      await ingester.ingestFile(file);
    }

    // Run all queries — fetch 20 results for @10/@20 evaluation
    searchResults = new Map();
    const reader = nextReader(bundle);
    for (const entry of GOLDEN_1000) {
      const results = await hybridSearch(reader, 'project', entry.query, embedder, { limit: 20 });
      searchResults.set(entry.query, results.map((r) => r.source_uri));
    }
  }, 900_000);

  afterAll(() => {
    if (bundle) closeDb(bundle);
    if (tmp) rmSync(tmp, { recursive: true, force: true });
    __resetSingleFlightForTests();
  });

  it('hit rate @10 >= 90% (50 queries including cross-domain)', () => {
    const golden10 = GOLDEN_1000.map((e) => ({ ...e, k: 10 }));
    const metrics = evaluateGoldenSet(searchResults, golden10);
    reportMetrics('wiki-1000 @10', metrics, 10);
    // 90% gate on full set (cross-domain + natural-lang queries are harder);
    // ablation confirms 97.5% @10 on 40 exact-match queries
    expect(metrics.hitRate).toBeGreaterThanOrEqual(0.9);
  });

  it('hit rate @20 >= 95% (50 queries)', () => {
    const golden20 = GOLDEN_1000.map((e) => ({ ...e, k: 20 }));
    const metrics = evaluateGoldenSet(searchResults, golden20);
    reportMetrics('wiki-1000 @20', metrics, 20);
    expect(metrics.hitRate).toBeGreaterThanOrEqual(0.95);
  });

  it('MRR >= 0.4', () => {
    const metrics = evaluateGoldenSet(searchResults, GOLDEN_1000);
    expect(metrics.mrr).toBeGreaterThanOrEqual(0.4);
  });

  // Per-domain accuracy at @10
  for (const [prefix, label] of [
    ['arch-', 'architecture'],
    ['api-', 'API'],
    ['db-', 'database'],
    ['sec-', 'security'],
    ['ops-', 'devops'],
    ['fe-', 'frontend'],
    ['test-', 'testing'],
    ['perf-', 'performance'],
  ] as const) {
    it(`${label} queries: >= 60% hit rate @10`, () => {
      const subset = GOLDEN_1000.filter((e) => e.expectedFiles.some((f) => f.startsWith(prefix))).map((e) => ({ ...e, k: 10 }));
      if (subset.length === 0) return;
      const metrics = evaluateGoldenSet(searchResults, subset);
      reportMetrics(`wiki-1000/${label} @10`, metrics, 10);
      expect(metrics.hitRate).toBeGreaterThanOrEqual(0.6);
    });
  }

  it('cross-domain queries @10: report metrics', () => {
    const crossDomain = GOLDEN_1000.filter((e) => {
      const prefixes = new Set(e.expectedFiles.map((f) => f.split('-')[0]));
      return prefixes.size > 1;
    }).map((e) => ({ ...e, k: 10 }));
    const metrics = evaluateGoldenSet(searchResults, crossDomain);
    reportMetrics('wiki-1000/cross-domain @10', metrics, 10);
    // Cross-domain is harder — report metrics but gate at 40%
    expect(metrics.hitRate).toBeGreaterThanOrEqual(0.4);
  });

  it('natural-language queries @10: report metrics', () => {
    const naturalLang = GOLDEN_1000.slice(-5).map((e) => ({ ...e, k: 10 }));
    const metrics = evaluateGoldenSet(searchResults, naturalLang);
    reportMetrics('wiki-1000/natural-lang @10', metrics, 10);
    // Fuzzy queries over 6K chunks with MiniLM-L6 — gate at 40%
    expect(metrics.hitRate).toBeGreaterThanOrEqual(0.4);
  });
});
