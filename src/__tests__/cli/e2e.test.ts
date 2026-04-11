import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { openDb, closeDb, type DbBundle } from '../../db/client.js';
import { Repository } from '../../db/repository.js';
import { IngesterService } from '../../ingest/ingester.js';
import { listMarkdownFiles } from '../../ingest/manifest.js';
import { makeSearchHandler } from '../../mcp/tools/search.js';
import { makeExecuteHandler } from '../../mcp/tools/execute.js';
import { CountingEmbedder, getDefaultEmbedder } from '../../retrieval/embedder.js';
import { QuickJSExecutor } from '../../sandbox/executor.js';
import { __resetSingleFlightForTests } from '../../ingest/ingester.js';
import { exportCommand } from '../../cli/export.js';
import { importCommand } from '../../cli/import.js';
import { purgeCommand } from '../../cli/purge.js';
import { auditCommand } from '../../cli/audit.js';
import { statusCommand } from '../../cli/status.js';

/**
 * Fresh-install end-to-end test (Phase 7 acceptance criterion #3).
 *
 * Simulates the full lifecycle:
 *   1. Build from fixture wiki (ingest all markdown)
 *   2. Run 5 queries through the tool handlers
 *   3. Verify all produce valid envelopes with results
 *   4. Test CLI subcommands (export, import, purge, audit, status)
 */

const __dirname = resolve(fileURLToPath(import.meta.url), '..');
const FIXTURE_DIR = resolve(__dirname, '../fixtures/wiki');

interface Envelope {
  result: unknown;
  meta: {
    tokens_budgeted: number;
    tokens_used: number;
    results_truncated: boolean;
    scope: string;
    query_time_ms: number;
    stale_files: string[];
  };
  logs?: string[];
}

describe('fresh-install e2e (Phase 7)', () => {
  let tmp: string;
  let wikiDir: string;
  let dbPath: string;
  let bundle: DbBundle;
  let embedder: CountingEmbedder;
  let executor: QuickJSExecutor;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let searchHandler: (args: any) => Promise<{ content: [{ type: 'text'; text: string }] }>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let executeHandler: (args: any) => Promise<{ content: [{ type: 'text'; text: string }] }>;

  beforeEach(async () => {
    __resetSingleFlightForTests();
    tmp = mkdtempSync(join(tmpdir(), 'pinakes-e2e-'));
    wikiDir = join(tmp, 'wiki');
    dbPath = join(tmp, 'pinakes.db');
    mkdirSync(wikiDir, { recursive: true });

    // Copy fixtures
    for (const name of ['auth.md', 'database.md', 'log.md']) {
      copyFileSync(join(FIXTURE_DIR, name), join(wikiDir, name));
    }

    // Step 1: Build from markdown
    bundle = openDb(dbPath);
    embedder = new CountingEmbedder(getDefaultEmbedder());
    await embedder.warmup();

    const ingester = new IngesterService(bundle, embedder, 'project', wikiDir);
    for (const file of listMarkdownFiles(wikiDir)) {
      await ingester.ingestFile(file);
    }

    // Step 2: Build tool handlers
    const repository = new Repository(bundle);
    executor = new QuickJSExecutor();
    await executor.warmup();

    searchHandler = makeSearchHandler({ repository, embedder, bundle });
    executeHandler = makeExecuteHandler({
      repository, executor, bundle, embedder, wikiRoot: wikiDir,
    });
  }, 60_000);

  afterEach(() => {
    closeDb(bundle);
    rmSync(tmp, { recursive: true, force: true });
    __resetSingleFlightForTests();
  });

  function parseEnvelope(response: { content: [{ type: 'text'; text: string }] }): Envelope {
    const envelope = JSON.parse(response.content[0].text) as Envelope;
    expect(envelope).toHaveProperty('result');
    expect(envelope).toHaveProperty('meta');
    expect(envelope.meta).toHaveProperty('tokens_budgeted');
    expect(envelope.meta).toHaveProperty('tokens_used');
    expect(envelope.meta).toHaveProperty('scope');
    expect(envelope.meta).toHaveProperty('query_time_ms');
    expect(envelope.meta).toHaveProperty('stale_files');
    return envelope;
  }

  // Query 1: basic FTS search
  it('query 1: search for "authentication"', async () => {
    const res = await searchHandler({ query: 'authentication', scope: 'project' });
    const env = parseEnvelope(res);
    expect(Array.isArray(env.result)).toBe(true);
    expect((env.result as unknown[]).length).toBeGreaterThan(0);
    expect(env.meta.scope).toBe('project');
  });

  // Query 2: search with budget constraint
  it('query 2: search with max_tokens=1000', async () => {
    const res = await searchHandler({ query: 'database', max_tokens: 1000 });
    const env = parseEnvelope(res);
    expect(Array.isArray(env.result)).toBe(true);
    // tokens_budgeted reflects the internal budget after safety margin, not raw max_tokens
    expect(env.meta.tokens_budgeted).toBeLessThanOrEqual(1000);
  });

  // Query 3: execute FTS binding
  it('query 3: execute with fts()', async () => {
    const res = await executeHandler({
      code: 'return pinakes.project.fts("bcrypt")',
      scope: 'project',
    });
    const env = parseEnvelope(res);
    expect(Array.isArray(env.result)).toBe(true);
    expect((env.result as unknown[]).length).toBeGreaterThan(0);
  });

  // Query 4: execute node lookup
  it('query 4: execute hybrid search', async () => {
    const res = await executeHandler({
      code: 'return pinakes.project.hybrid("password hashing")',
      scope: 'project',
    });
    const env = parseEnvelope(res);
    expect(Array.isArray(env.result)).toBe(true);
  });

  // Query 5: execute with write + read round-trip
  it('query 5: execute write and read back', async () => {
    const res = await executeHandler({
      code: `
        pinakes.project.write("e2e-test.md", "# E2E Test\\nThis was written by the e2e test.");
        return pinakes.project.fts("E2E Test");
      `,
      scope: 'project',
    });
    const env = parseEnvelope(res);
    // Write succeeded (no error in result)
    expect(env.result).not.toHaveProperty('error');
  });

  // CLI subcommands
  it('status command returns valid data', () => {
    const statuses = statusCommand({ dbPath, wikiPath: wikiDir });
    expect(statuses.length).toBe(2); // project + personal
    const project = statuses.find((s) => s.scope === 'project')!;
    expect(project.exists).toBe(true);
    expect(project.rowCounts['pinakes_nodes']).toBeGreaterThan(0);
    expect(project.rowCounts['pinakes_chunks']).toBeGreaterThan(0);
  });

  it('export → import round-trip preserves data', () => {
    // Export
    const exportData = exportCommand({ scope: 'project', dbPath });
    expect(exportData.nodes.length).toBeGreaterThan(0);
    expect(exportData.chunks.length).toBeGreaterThan(0);

    // Write to file
    const exportPath = join(tmp, 'export.json');
    exportCommand({ scope: 'project', dbPath, out: exportPath });

    // Create a fresh DB and import
    const freshDbPath = join(tmp, 'fresh-pinakes.db');
    const result = importCommand({
      scope: 'project',
      inFile: exportPath,
      dbPath: freshDbPath,
    });
    expect(result.nodes).toBe(exportData.nodes.length);
    expect(result.chunks).toBe(exportData.chunks.length);
  });

  it('purge without --confirm is a no-op', () => {
    const result = purgeCommand({ scope: 'project', dbPath });
    expect(result.deleted).toBe(false);
    expect(result.reason).toContain('--confirm');
  });

  it('audit command returns rows (empty for fresh DB)', () => {
    // Fresh DB has no audit rows (audit is written by the serve wrapper, not direct handler calls)
    const rows = auditCommand({ dbPath, scope: 'project' });
    expect(Array.isArray(rows)).toBe(true);
  });
});
