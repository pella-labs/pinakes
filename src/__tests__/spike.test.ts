import { afterAll, describe, it, expect, beforeAll } from 'vitest';
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { closeDb, openDb, type DbBundle } from '../db/client.js';
import { Repository } from '../db/repository.js';
import { IngesterService, __resetSingleFlightForTests } from '../ingest/ingester.js';
import { CountingEmbedder, getDefaultEmbedder } from '../retrieval/embedder.js';
import { QuickJSExecutor } from '../sandbox/executor.js';
import { makeSearchHandler } from '../mcp/tools/search.js';
import { makeExecuteHandler } from '../mcp/tools/execute.js';
import {
  searchToolConfig,
} from '../mcp/tools/search.js';
import { executeToolConfig } from '../mcp/tools/execute.js';
import { countTokens } from '../gate/budget.js';

/**
 * Tool-surface tests — kept stable across the Phase 1 → Phase 2 swap.
 *
 * Originally Phase 1's "spike tests" backed by `MemoryStore`; Phase 2 swapped
 * the backing store to a real SQLite `Repository` while keeping the tool
 * surface (and every assertion below) unchanged. The five PRD-required tests
 * are marked inline with `PRD.md lines 104-109`, plus two acceptance-criteria
 * tests (#9 cold-start benchmark, #10 budget math sanity), one binding-sanity
 * test, and one schema-footprint test.
 */

const FIXTURE_DIR = resolve(
  fileURLToPath(new URL('./fixtures/wiki', import.meta.url))
);

let bundle: DbBundle;
let repository: Repository;
let executor: QuickJSExecutor;
let embedder: CountingEmbedder;
let searchHandler: ReturnType<typeof makeSearchHandler>;
let executeHandler: ReturnType<typeof makeExecuteHandler>;
let tmpRoot: string;

beforeAll(async () => {
  __resetSingleFlightForTests();

  // Build a real Phase 2 stack: tmpdir → SQLite → ingest fixtures → Repository.
  // This replaces the Phase 1 in-memory MemoryStore with the production stack
  // while preserving every tool-surface assertion below.
  tmpRoot = mkdtempSync(join(tmpdir(), 'pinakes-spike-tests-'));
  const wikiDir = join(tmpRoot, 'wiki');
  mkdirSync(wikiDir, { recursive: true });
  for (const name of readdirSync(FIXTURE_DIR)) {
    copyFileSync(join(FIXTURE_DIR, name), join(wikiDir, name));
  }

  bundle = openDb(join(tmpRoot, 'pinakes.db'));
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
  searchHandler = makeSearchHandler({ repository, embedder, bundle });
  executeHandler = makeExecuteHandler({ repository, executor, bundle, embedder });
});

afterAll(() => {
  if (bundle) closeDb(bundle);
  if (tmpRoot) rmSync(tmpRoot, { recursive: true, force: true });
  __resetSingleFlightForTests();
});

/**
 * Parse a tool-handler response into the envelope + raw text so tests can
 * assert on both the outer MCP shape and the inner result body.
 */
function parseResponse(response: { content: [{ type: 'text'; text: string }] }) {
  const text = response.content[0]?.text ?? '';
  return { text, envelope: JSON.parse(text) };
}

describe('search (PRD Phase 1)', () => {
  it('returns ≥1 result for hashPassword query (PRD #4)', async () => {
    const res = await searchHandler({ query: 'hashPassword' });
    const { envelope } = parseResponse(res);
    expect(envelope.result).toBeInstanceOf(Array);
    expect(envelope.result.length).toBeGreaterThanOrEqual(1);
    expect(envelope.meta.tokens_used).toBeGreaterThan(0);
    expect(envelope.meta.tokens_used).toBeLessThan(5000);
    expect(envelope.meta.scope).toBe('project');
    expect(typeof envelope.meta.query_time_ms).toBe('number');
  });

  it('returns ≥1 result for bcrypt query', async () => {
    const res = await searchHandler({ query: 'bcrypt' });
    const { envelope } = parseResponse(res);
    expect(envelope.result.length).toBeGreaterThanOrEqual(1);
    expect(envelope.result[0]).toHaveProperty('id');
    expect(envelope.result[0]).toHaveProperty('text');
    expect(envelope.result[0]).toHaveProperty('source_uri');
  });

  it('returns results without error for unknown query (vec returns nearest neighbors)', async () => {
    const res = await searchHandler({ query: 'zzzzzzz_no_such_thing_zzzzzzz' });
    const { envelope } = parseResponse(res);
    // Hybrid search: FTS5 returns [] for nonsense, but vec returns nearest
    // neighbors regardless. Result may be non-empty (vec-only RRF scores).
    expect(Array.isArray(envelope.result)).toBe(true);
    expect(envelope.meta.results_truncated).toBe(false);
  });
});

describe('execute (PRD Phase 1)', () => {
  it('runs `return pinakes.search("x").length` and returns the count (PRD #2)', async () => {
    const res = await executeHandler({
      code: "return pinakes.search('hashPassword').length",
    });
    const { envelope } = parseResponse(res);
    const repoHits = repository.search('hashPassword', 'project').length;
    expect(envelope.result).toBe(repoHits);
    expect(repoHits).toBeGreaterThanOrEqual(1);
  });

  it('pinakes.search binding returns chunk shape with id/text/source_uri', async () => {
    const res = await executeHandler({
      code: "return pinakes.search('bcrypt').slice(0, 3).map(h => h.id)",
    });
    const { envelope } = parseResponse(res);
    expect(envelope.result).toBeInstanceOf(Array);
    expect(envelope.result.length).toBeLessThanOrEqual(3);
    for (const id of envelope.result) {
      expect(typeof id).toBe('string');
      expect(id.length).toBeGreaterThan(0);
    }
  });

  it('truncates a giant result to fit under max_tokens (PRD #3)', async () => {
    const res = await executeHandler({
      code: "return Array(1000).fill('blah blah blah')",
    });
    const { envelope } = parseResponse(res);
    expect(envelope.meta.results_truncated).toBe(true);
    expect(envelope.meta.tokens_used).toBeLessThanOrEqual(5000);
  });

  it('kills infinite loops within the timeout window (PRD #4)', async () => {
    const started = Date.now();
    const res = await executeHandler({
      code: 'while(true){}',
      timeout_ms: 2000,
    });
    const elapsed = Date.now() - started;
    const { envelope } = parseResponse(res);
    expect(envelope.result).toHaveProperty('error');
    expect(elapsed).toBeLessThan(3500); // 2s timeout + generous slack
  });

  it('blocks eval() via disabled globals (PRD #5)', async () => {
    const res = await executeHandler({ code: "return eval('1+1')" });
    const { envelope } = parseResponse(res);
    expect(envelope.result).toHaveProperty('error');
    const err = String(envelope.result.error);
    // Either the custom "not available" message or any mention of eval
    expect(err.toLowerCase()).toMatch(/eval|not available|not defined/);
  });

  it('captures logger.log output into envelope.logs', async () => {
    const res = await executeHandler({
      code: "logger.log('hello', { n: 42 }); return 'ok'",
    });
    const { envelope } = parseResponse(res);
    expect(envelope.result).toBe('ok');
    expect(envelope.logs).toBeInstanceOf(Array);
    expect(envelope.logs.length).toBeGreaterThanOrEqual(1);
    expect(envelope.logs[0]).toContain('hello');
  });
});

describe('PRD acceptance criteria #9 — sandbox cold-start p50 < 150ms', () => {
  it('measures cold-start latency over 20 fresh contexts', async () => {
    const samples: number[] = [];
    for (let i = 0; i < 20; i++) {
      const freshExecutor = new QuickJSExecutor();
      await freshExecutor.warmup(); // module load excluded per PRD note
      const freshHandler = makeExecuteHandler({ repository, executor: freshExecutor, bundle, embedder });
      const start = performance.now();
      await freshHandler({ code: 'return 1 + 1' });
      samples.push(performance.now() - start);
    }
    samples.sort((a, b) => a - b);
    const p50 = samples[Math.floor(samples.length * 0.5)]!;
    const p95 = samples[Math.floor(samples.length * 0.95)]!;
    console.error(
      `[cold-start] n=20 p50=${p50.toFixed(2)}ms p95=${p95.toFixed(2)}ms ` +
        `min=${samples[0]!.toFixed(2)}ms max=${samples[samples.length - 1]!.toFixed(2)}ms`
    );
    expect(p50).toBeLessThan(150);
  });
});

describe('PRD acceptance criteria #10 — budget math sanity', () => {
  it('15 medium objects at max_tokens=5000 — response stays under limit', async () => {
    const res = await executeHandler({
      code:
        "return Array(15).fill({ id: 'x', uri: 'file:///long/path/x.md', " +
        "confidence: 'extracted', body: 'a very long body '.repeat(20) })",
      max_tokens: 5000,
    });
    const { text, envelope } = parseResponse(res);
    const actualTokens = countTokens(text);
    expect(envelope.meta.tokens_used).toBeLessThanOrEqual(5000);
    expect(actualTokens).toBeLessThanOrEqual(5000);
    // meta.tokens_used should match the actually-measured envelope size
    // within the 10% js-tiktoken safety margin.
    const ratio = envelope.meta.tokens_used / actualTokens;
    expect(ratio).toBeGreaterThan(0.9);
    expect(ratio).toBeLessThan(1.1);
  });

  it('single oversize scalar result emits an error message, not a hung reply', async () => {
    const res = await executeHandler({
      code: "return 'x'.repeat(60000)",
      max_tokens: 5000,
    });
    const { envelope } = parseResponse(res);
    expect(envelope.meta.results_truncated).toBe(true);
    expect(envelope.result).toHaveProperty('error');
  });
});

describe('tool schema footprint (CLAUDE.md §API Rules #2)', () => {
  it('total tool schema footprint stays under 1500 tokens', () => {
    // Serialize the descriptions + inputSchema shapes. The zod shapes
    // themselves aren't directly serializable, so we stringify the whole
    // config object which includes descriptions (the bulk of the tokens)
    // and parameter keys.
    const serialize = (config: typeof searchToolConfig | typeof executeToolConfig) => {
      return JSON.stringify({
        title: config.title,
        description: config.description,
        inputShape: Object.keys(config.inputSchema),
      });
    };
    const total =
      countTokens(serialize(searchToolConfig)) +
      countTokens(serialize(executeToolConfig));
    console.error(`[schema footprint] total=${total} tokens (budget 1500)`);
    expect(total).toBeLessThan(1500);
  });
});
