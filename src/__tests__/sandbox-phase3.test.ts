import { afterAll, describe, it, expect, beforeAll } from 'vitest';
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { getQuickJS } from 'quickjs-emscripten';
import { closeDb, openDb, type DbBundle } from '../db/client.js';
import { Repository } from '../db/repository.js';
import { IngesterService, __resetSingleFlightForTests } from '../ingest/ingester.js';
import { CountingEmbedder, getDefaultEmbedder } from '../retrieval/embedder.js';
import { QuickJSExecutor } from '../sandbox/executor.js';
import { SandboxPool } from '../sandbox/pool.js';
import { makeKgExecuteHandler } from '../mcp/tools/execute.js';
import type { BindingDeps } from '../sandbox/bindings/install.js';

/**
 * Phase 3 sandbox tests — warm pool, full `kg.project.*` bindings, budget
 * helper, disabled globals adversarial, and resource limit verification.
 *
 * All tests use real SQLite and real QuickJS (CLAUDE.md §Testing Rules #5-6).
 */

const FIXTURE_DIR = resolve(
  fileURLToPath(new URL('./fixtures/wiki', import.meta.url))
);

let bundle: DbBundle;
let repository: Repository;
let executor: QuickJSExecutor;
let executeHandler: ReturnType<typeof makeKgExecuteHandler>;
let tmpRoot: string;

/** Helper to build BindingDeps for direct `executeWithBindings` calls. */
function makeDeps(overrides?: Partial<BindingDeps>): BindingDeps {
  const embedder = getDefaultEmbedder();
  return {
    project: { repository, bundle, scope: 'project', embedder },
    maxTokens: 5000,
    logs: [],
    ...overrides,
  };
}

/** Parse a tool-handler response into envelope + raw text. */
function parseResponse(response: { content: [{ type: 'text'; text: string }] }) {
  const text = response.content[0]?.text ?? '';
  return { text, envelope: JSON.parse(text) };
}

beforeAll(async () => {
  __resetSingleFlightForTests();

  tmpRoot = mkdtempSync(join(tmpdir(), 'kg-phase3-'));
  const wikiDir = join(tmpRoot, 'wiki');
  mkdirSync(wikiDir, { recursive: true });
  for (const name of readdirSync(FIXTURE_DIR)) {
    copyFileSync(join(FIXTURE_DIR, name), join(wikiDir, name));
  }

  bundle = openDb(join(tmpRoot, 'kg.db'));
  const embedder = new CountingEmbedder(getDefaultEmbedder());
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
  executeHandler = makeKgExecuteHandler({ repository, executor, bundle, embedder });
});

afterAll(() => {
  executor?.dispose();
  if (bundle) closeDb(bundle);
  if (tmpRoot) rmSync(tmpRoot, { recursive: true, force: true });
  __resetSingleFlightForTests();
});

// ============================================================================
// Disabled globals adversarial (7 tests)
// ============================================================================

describe('disabled globals adversarial (Phase 3)', () => {
  it('eval() is not available', async () => {
    const result = await executor.executeWithBindings(
      "return eval('1+1')",
      makeDeps()
    );
    expect(result.error).toBeTruthy();
    expect(result.error!.toLowerCase()).toMatch(/eval|not available|not defined/);
  });

  it('Function() constructor is not available', async () => {
    const result = await executor.executeWithBindings(
      "return new Function('return 1')()",
      makeDeps()
    );
    expect(result.error).toBeTruthy();
    expect(result.error!.toLowerCase()).toMatch(/function|not available|not defined/);
  });

  it('dynamic import() is not available', async () => {
    const result = await executor.executeWithBindings(
      "const m = await import('fs'); return m",
      makeDeps()
    );
    // QuickJS doesn't support dynamic import — it's a compile/eval error
    expect(result.error).toBeTruthy();
  });

  it('fetch() is not available', async () => {
    const result = await executor.executeWithBindings(
      "return fetch('http://example.com')",
      makeDeps()
    );
    expect(result.error).toBeTruthy();
    expect(result.error!.toLowerCase()).toMatch(/fetch|not available|not defined/);
  });

  it('require() is not available', async () => {
    const result = await executor.executeWithBindings(
      "return require('fs')",
      makeDeps()
    );
    expect(result.error).toBeTruthy();
    expect(result.error!.toLowerCase()).toMatch(/require|not available|not defined/);
  });

  it('process is not available', async () => {
    const result = await executor.executeWithBindings(
      'return process.env',
      makeDeps()
    );
    expect(result.error).toBeTruthy();
    expect(result.error!.toLowerCase()).toMatch(/process|not available|not defined/);
  });

  it('globalThis.constructor is not available', async () => {
    const result = await executor.executeWithBindings(
      "return globalThis.constructor.constructor('return this')()",
      makeDeps()
    );
    expect(result.error).toBeTruthy();
    expect(result.error!.toLowerCase()).toMatch(/constructor|not available|not defined/);
  });
});

// ============================================================================
// Warm pool instrumentation (3 tests)
// ============================================================================

describe('warm pool (Phase 3)', () => {
  it('sequential calls reuse warm runtimes', async () => {
    // Reset stats by creating a fresh executor for this test.
    const poolExecutor = new QuickJSExecutor({ poolSize: 2 });
    await poolExecutor.warmup();
    try {
      await poolExecutor.executeWithBindings('return 1', makeDeps());
      await poolExecutor.executeWithBindings('return 2', makeDeps());
      const stats = poolExecutor.getPoolStats()!;
      expect(stats.warmHits).toBeGreaterThanOrEqual(2);
      expect(stats.coldHits).toBe(0);
    } finally {
      poolExecutor.dispose();
    }
  });

  it('overflow spawns cold runtime when pool is exhausted', async () => {
    // Test the pool directly: acquire 3 from a pool of 2.
    // executeWithBindings is effectively synchronous (single-threaded),
    // so we test acquire/release directly to verify overflow behavior.
    const wasm = await getQuickJS();
    const pool = new SandboxPool(wasm, { poolSize: 2 });
    try {
      const r1 = pool.acquire();
      const r2 = pool.acquire();
      const r3 = pool.acquire(); // overflow — cold spawn
      expect(r1.isWarm).toBe(true);
      expect(r2.isWarm).toBe(true);
      expect(r3.isWarm).toBe(false);
      const stats = pool.getStats();
      expect(stats.coldHits).toBe(1);
      expect(stats.warmHits).toBe(2);
      pool.release(r1, false);
      pool.release(r2, false);
      pool.release(r3, false); // overflow runtime disposed, not returned
    } finally {
      pool.dispose();
    }
  });

  it('crash recovery: crashed runtime is replaced in pool', async () => {
    const wasm = await getQuickJS();
    const pool = new SandboxPool(wasm, { poolSize: 2 });
    try {
      // Acquire a warm runtime and release it as crashed.
      const r1 = pool.acquire();
      expect(r1.isWarm).toBe(true);
      const crashedId = r1.id;
      pool.release(r1, true); // simulate crash

      const stats = pool.getStats();
      expect(stats.crashes).toBe(1);
      // Pool should still have 2 available (crashed one replaced).
      expect(stats.currentSize).toBe(2);

      // Next acquire should get a warm runtime with a different id.
      const r2 = pool.acquire();
      expect(r2.isWarm).toBe(true);
      expect(r2.id).not.toBe(crashedId);
      pool.release(r2, false);
    } finally {
      pool.dispose();
    }
  });
});

// ============================================================================
// Resource limits (2 tests)
// ============================================================================

describe('resource limits (Phase 3)', () => {
  it('timeout: while(true){} killed within 2s', async () => {
    const started = Date.now();
    const result = await executor.executeWithBindings(
      'while(true){}',
      makeDeps(),
      2000
    );
    const elapsed = Date.now() - started;
    expect(result.error).toBeTruthy();
    expect(elapsed).toBeLessThan(3500);
  });

  it('memory: allocating >64MB throws inside sandbox, host survives', async () => {
    const result = await executor.executeWithBindings(
      'const a = []; while(true) a.push(new Array(100000).fill("x")); return a.length',
      makeDeps()
    );
    expect(result.error).toBeTruthy();
    // Verify host is fine — a simple call still works.
    const ok = await executor.executeWithBindings('return "alive"', makeDeps());
    expect(ok.result).toBe('alive');
  });
});

// ============================================================================
// kg.project.* bindings (7 tests)
// ============================================================================

describe('kg.project bindings (Phase 3)', () => {
  it('fts() returns results with rank field sorted by bm25', async () => {
    const result = await executor.executeWithBindings(
      "return kg.project.fts('password')",
      makeDeps()
    );
    expect(result.error).toBeUndefined();
    expect(result.result).toBeInstanceOf(Array);
    const arr = result.result as Array<{ id: string; rank: number; node_id: string }>;
    expect(arr.length).toBeGreaterThanOrEqual(1);
    expect(arr[0]).toHaveProperty('rank');
    expect(arr[0]).toHaveProperty('node_id');
    // bm25 values are negative (lower = better match)
    for (let i = 1; i < arr.length; i++) {
      expect(arr[i]!.rank).toBeGreaterThanOrEqual(arr[i - 1]!.rank);
    }
  });

  it('fts() respects limit option', async () => {
    const result = await executor.executeWithBindings(
      "return kg.project.fts('password', { limit: 2 })",
      makeDeps()
    );
    expect(result.error).toBeUndefined();
    const arr = result.result as unknown[];
    expect(arr.length).toBeLessThanOrEqual(2);
  });

  it('get() returns node with full section content', async () => {
    // First get a node id via fts
    const ftsResult = await executor.executeWithBindings(
      "return kg.project.fts('password')[0]?.node_id",
      makeDeps()
    );
    const nodeId = ftsResult.result as string;
    expect(nodeId).toBeTruthy();

    const result = await executor.executeWithBindings(
      `return kg.project.get('${nodeId}')`,
      makeDeps()
    );
    expect(result.error).toBeUndefined();
    const node = result.result as {
      id: string;
      source_uri: string;
      kind: string;
      content: string;
    };
    expect(node).not.toBeNull();
    expect(node.id).toBe(nodeId);
    expect(node).toHaveProperty('content');
    expect(node).toHaveProperty('source_uri');
    expect(node.kind).toBe('section');
  });

  it('neighbors() returns [] with empty edges (validates SQL)', async () => {
    const ftsResult = await executor.executeWithBindings(
      "return kg.project.fts('password')[0]?.node_id",
      makeDeps()
    );
    const nodeId = ftsResult.result as string;

    const result = await executor.executeWithBindings(
      `return kg.project.neighbors('${nodeId}')`,
      makeDeps()
    );
    expect(result.error).toBeUndefined();
    expect(result.result).toEqual([]);
  });

  it('log.recent() returns ingest events', async () => {
    const result = await executor.executeWithBindings(
      'return kg.project.log.recent(5)',
      makeDeps()
    );
    expect(result.error).toBeUndefined();
    const arr = result.result as Array<{ kind: string; ts: number }>;
    expect(arr.length).toBeGreaterThanOrEqual(1);
    expect(arr[0]).toHaveProperty('ts');
    expect(arr[0]).toHaveProperty('kind');
  });

  it('vec() returns [] without pre-computed embedding', async () => {
    const result = await executor.executeWithBindings(
      "return kg.project.vec('test')",
      makeDeps()
    );
    expect(result.error).toBeUndefined();
    expect(result.result).toEqual([]);
  });

  it('hybrid() returns FTS-only results (no cached embedding), gaps() returns array', async () => {
    const r1 = await executor.executeWithBindings(
      "return kg.project.hybrid('bcrypt')",
      makeDeps()
    );
    expect(r1.error).toBeUndefined();
    // hybrid without cached embedding degrades to FTS-only; bcrypt is in the fixture
    const arr = r1.result as Array<{ id: string; text: string; score: number }>;
    expect(arr.length).toBeGreaterThan(0);
    expect(arr[0]).toHaveProperty('score');

    const r2 = await executor.executeWithBindings(
      'return kg.project.gaps()',
      makeDeps()
    );
    expect(r2.error).toBeUndefined();
    expect(Array.isArray(r2.result)).toBe(true);
  });
});

// ============================================================================
// Complex chained snippet (1 test)
// ============================================================================

describe('complex snippet (Phase 3)', () => {
  it('kg.project.fts().filter().slice() chain works', async () => {
    const result = await executor.executeWithBindings(
      `return kg.project.fts('password')
         .filter(r => r.source_uri.includes('auth'))
         .slice(0, 3)
         .map(r => ({ id: r.id, rank: r.rank }))`,
      makeDeps()
    );
    expect(result.error).toBeUndefined();
    expect(result.result).toBeInstanceOf(Array);
  });
});

// ============================================================================
// Budget helper (1 test)
// ============================================================================

describe('budget.fit() in sandbox (Phase 3)', () => {
  it('truncates a 100-item array to fit under token budget', async () => {
    const result = await executor.executeWithBindings(
      `const items = Array.from({length: 100}, (_, i) => ({
        id: 'item-' + i,
        text: 'word '.repeat(50),
        source_uri: 'file:///test/' + i + '.md'
      }));
      return budget.fit(items, 5000).length`,
      makeDeps()
    );
    expect(result.error).toBeUndefined();
    const count = result.result as number;
    expect(count).toBeGreaterThan(0);
    expect(count).toBeLessThan(100);
  });
});

// ============================================================================
// Backward compatibility (2 tests)
// ============================================================================

describe('backward compat (Phase 3)', () => {
  it('kg.search() still works via handler', async () => {
    const res = await executeHandler({
      code: "return kg.search('hashPassword').length",
    });
    const { envelope } = parseResponse(res);
    expect(envelope.result).toBeGreaterThanOrEqual(1);
  });

  it('kg.get() still works via handler', async () => {
    // Get a chunk id first
    const searchRes = await executeHandler({
      code: "return kg.search('hashPassword')[0]?.id",
    });
    const { envelope: searchEnv } = parseResponse(searchRes);
    const chunkId = searchEnv.result as string;
    expect(chunkId).toBeTruthy();

    const getRes = await executeHandler({
      code: `return kg.get('${chunkId}')`,
    });
    const { envelope } = parseResponse(getRes);
    expect(envelope.result).not.toBeNull();
    expect(envelope.result).toHaveProperty('id', chunkId);
    expect(envelope.result).toHaveProperty('text');
    expect(envelope.result).toHaveProperty('source_uri');
  });
});

// ============================================================================
// Benchmark (1 test)
// ============================================================================

describe('warm pool p95 benchmark (Phase 3)', () => {
  it('20 sequential warm-pool calls have p95 < 200ms', async () => {
    const samples: number[] = [];
    for (let i = 0; i < 20; i++) {
      const start = performance.now();
      await executor.executeWithBindings('return 1 + 1', makeDeps());
      samples.push(performance.now() - start);
    }
    samples.sort((a, b) => a - b);
    const p95 = samples[Math.floor(samples.length * 0.95)]!;
    console.error(
      `[warm-pool] n=20 p50=${samples[Math.floor(samples.length * 0.5)]!.toFixed(2)}ms ` +
        `p95=${p95.toFixed(2)}ms`
    );
    expect(p95).toBeLessThan(200);
  });
});
