import { afterAll, describe, it, expect, beforeAll } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { closeDb, openDb, nextReader, type DbBundle } from '../../db/client.js';
import { IngesterService, __resetSingleFlightForTests } from '../../ingest/ingester.js';
import { CountingEmbedder, getDefaultEmbedder } from '../../retrieval/embedder.js';
import { hybridSearch } from '../../retrieval/hybrid.js';

/**
 * Phase 4 benchmark: query p95 <500ms on a 5K-chunk fixture.
 *
 * Generates ~100 markdown files with ~50 chunks each ≈ 5000 chunks,
 * ingests them with real embeddings, then runs hybrid queries and
 * asserts p95 < 500ms.
 *
 * This test is slow (~60s for ingest) and is gated behind a long timeout.
 */

const TOPICS = [
  'authentication', 'authorization', 'database', 'caching', 'logging',
  'monitoring', 'deployment', 'testing', 'security', 'performance',
  'networking', 'storage', 'messaging', 'scheduling', 'configuration',
  'migrations', 'validation', 'serialization', 'compression', 'encryption',
];

const TERMS = [
  'bcrypt', 'JWT', 'OAuth', 'PostgreSQL', 'Redis', 'Kafka',
  'Docker', 'Kubernetes', 'GraphQL', 'REST', 'WebSocket', 'gRPC',
  'TLS', 'CORS', 'CSRF', 'XSS', 'WAL', 'MVCC', 'B-tree', 'LSM',
];

function generateMarkdown(fileIndex: number): string {
  const topic = TOPICS[fileIndex % TOPICS.length];
  const sections: string[] = [`# ${topic} module ${fileIndex}\n`];

  // Generate ~25 sections per file, each with ~5 paragraphs to reach ~5000 chunks total
  for (let s = 0; s < 25; s++) {
    const term1 = TERMS[(fileIndex + s) % TERMS.length];
    const term2 = TERMS[(fileIndex + s + 7) % TERMS.length];
    sections.push(`\n## Section ${s}: ${term1} integration\n`);

    for (let p = 0; p < 5; p++) {
      sections.push(
        `\nThe ${topic} layer uses ${term1} for primary operations and falls back to ` +
        `${term2} when the primary path is unavailable. This design was chosen after ` +
        `evaluating several alternatives including direct ${TERMS[(p + 3) % TERMS.length]} ` +
        `calls and a custom ${TOPICS[(fileIndex + p + 2) % TOPICS.length]} adapter. ` +
        `Performance testing showed ${Math.floor(Math.random() * 100 + 10)}ms p95 latency ` +
        `under load, which meets our SLA requirements. The implementation lives in ` +
        `src/${topic}/handler-${s}-${p}.ts and has ${Math.floor(Math.random() * 20 + 5)} ` +
        `unit tests covering edge cases like timeout handling, retry logic, and ` +
        `graceful degradation when the ${term2} cluster is unreachable.\n`
      );
    }
  }

  return sections.join('');
}

let bundle: DbBundle;
let embedder: CountingEmbedder;
let tmpRoot: string;

beforeAll(async () => {
  __resetSingleFlightForTests();

  tmpRoot = mkdtempSync(join(tmpdir(), 'pinakes-bench-'));
  const wikiDir = join(tmpRoot, 'wiki');
  mkdirSync(wikiDir, { recursive: true });

  // Generate ~100 files to reach ~5000 chunks
  for (let i = 0; i < 100; i++) {
    writeFileSync(join(wikiDir, `topic-${i}.md`), generateMarkdown(i));
  }

  bundle = openDb(join(tmpRoot, 'pinakes.db'));
  embedder = new CountingEmbedder(getDefaultEmbedder());
  await embedder.warmup();

  const ingester = new IngesterService(bundle, embedder, 'project', wikiDir);
  for (let i = 0; i < 100; i++) {
    await ingester.ingestFile(join(wikiDir, `topic-${i}.md`));
  }

  // Verify chunk count
  const reader = nextReader(bundle);
  const count = reader
    .prepare<[], { c: number }>(`SELECT count(*) AS c FROM pinakes_chunks`)
    .get()!.c;
  console.error(`[benchmark] ingested ${count} chunks from 100 files`);
}, 300_000); // 5 min timeout for ingest with embeddings

afterAll(() => {
  if (bundle) closeDb(bundle);
  if (tmpRoot) rmSync(tmpRoot, { recursive: true, force: true });
  __resetSingleFlightForTests();
});

describe('query p95 benchmark (Phase 4 exit gate)', () => {
  it('hybrid query p95 <500ms on 5K-chunk fixture', async () => {
    const reader = nextReader(bundle);
    const queries = [
      'bcrypt password hashing',
      'JWT authentication token',
      'database WAL mode',
      'Redis caching layer',
      'Docker deployment',
      'GraphQL schema validation',
      'WebSocket connection handling',
      'TLS certificate rotation',
      'Kafka message queue',
      'PostgreSQL migration',
    ];

    const samples: number[] = [];

    for (const query of queries) {
      const start = performance.now();
      await hybridSearch(reader, 'project', query, embedder, { limit: 20 });
      samples.push(performance.now() - start);
    }

    // Run each query twice more for stability
    for (const query of queries) {
      const start = performance.now();
      await hybridSearch(reader, 'project', query, embedder, { limit: 20 });
      samples.push(performance.now() - start);
    }

    samples.sort((a, b) => a - b);
    const p50 = samples[Math.floor(samples.length * 0.5)];
    const p95 = samples[Math.floor(samples.length * 0.95)];
    const max = samples[samples.length - 1];

    console.error(
      `[benchmark] n=${samples.length} p50=${p50.toFixed(1)}ms p95=${p95.toFixed(1)}ms max=${max.toFixed(1)}ms`
    );

    expect(p95).toBeLessThan(500);
  }, 60_000);
});
