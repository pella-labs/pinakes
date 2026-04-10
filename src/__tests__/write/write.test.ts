import { afterAll, afterEach, describe, it, expect, beforeAll } from 'vitest';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';


import { closeDb, openDb, nextReader, type DbBundle } from '../../db/client.js';
import { Repository } from '../../db/repository.js';
import { IngesterService, __resetSingleFlightForTests } from '../../ingest/ingester.js';
import { CountingEmbedder, getDefaultEmbedder } from '../../retrieval/embedder.js';
import { QuickJSExecutor } from '../../sandbox/executor.js';
import { makeKgExecuteHandler } from '../../mcp/tools/execute.js';
import { writeWikiFile, appendWikiLog, removeWikiFile, type WriteCounter } from '../../sandbox/bindings/write.js';

/**
 * Phase 4.5 write-path tests.
 *
 * Tests the full write lifecycle: path sanitization, containment, size/rate
 * limits, atomic writes, append, remove, audit logging, and end-to-end
 * sandbox integration.
 *
 * All tests use real SQLite per CLAUDE.md §Testing Rules #5.
 */

const FIXTURE_DIR = resolve(
  fileURLToPath(new URL('../fixtures/wiki', import.meta.url))
);

let bundle: DbBundle;
let repository: Repository;
let embedder: CountingEmbedder;
let executor: QuickJSExecutor;
let tmpRoot: string;
let wikiDir: string;

beforeAll(async () => {
  __resetSingleFlightForTests();

  tmpRoot = mkdtempSync(join(tmpdir(), 'kg-write-'));
  wikiDir = join(tmpRoot, 'wiki');
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

function freshCounter(): WriteCounter {
  return { value: 0 };
}

function parseResponse(response: { content: [{ type: 'text'; text: string }] }) {
  return JSON.parse(response.content[0]?.text ?? '');
}

// ============================================================================
// Path sanitization tests
// ============================================================================

describe('write path sanitization', () => {
  it('rejects path traversal (../../../etc/passwd)', () => {
    expect(() =>
      writeWikiFile(wikiDir, '../../../etc/passwd.md', '# evil', freshCounter(), 'project', bundle.writer)
    ).toThrow('path traversal');
  });

  it('rejects absolute paths', () => {
    expect(() =>
      writeWikiFile(wikiDir, '/tmp/evil.md', '# evil', freshCounter(), 'project', bundle.writer)
    ).toThrow('absolute paths');
  });

  it('rejects non-.md extensions', () => {
    expect(() =>
      writeWikiFile(wikiDir, 'evil.js', '// evil', freshCounter(), 'project', bundle.writer)
    ).toThrow('only .md files');
    expect(() =>
      writeWikiFile(wikiDir, 'config.json', '{}', freshCounter(), 'project', bundle.writer)
    ).toThrow('only .md files');
    expect(() =>
      writeWikiFile(wikiDir, '.env', 'SECRET=x', freshCounter(), 'project', bundle.writer)
    ).toThrow('only .md files');
  });

  it('rejects symlinks that escape wiki root', () => {
    const outsideDir = mkdtempSync(join(tmpdir(), 'kg-outside-'));
    const targetFile = join(outsideDir, 'escape.md');
    writeFileSync(targetFile, '# outside');
    const linkPath = join(wikiDir, 'symlink-escape.md');
    symlinkSync(targetFile, linkPath);

    try {
      expect(() =>
        writeWikiFile(wikiDir, 'symlink-escape.md', '# overwritten', freshCounter(), 'project', bundle.writer)
      ).toThrow('symlink escapes wiki root');
    } finally {
      rmSync(linkPath, { force: true });
      rmSync(outsideDir, { recursive: true, force: true });
    }
  });
});

// ============================================================================
// Size and rate limit tests
// ============================================================================

describe('write limits', () => {
  it('rejects content exceeding max write size (100KB)', () => {
    const bigContent = 'x'.repeat(102401); // just over 100KB
    expect(() =>
      writeWikiFile(wikiDir, 'big.md', bigContent, freshCounter(), 'project', bundle.writer)
    ).toThrow('exceeds max write size');
  });

  it('enforces rate limit of 20 writes per call', () => {
    const counter = freshCounter();
    // First 20 writes should succeed
    for (let i = 0; i < 20; i++) {
      writeWikiFile(wikiDir, `rate-test-${i}.md`, `# Test ${i}`, counter, 'project', bundle.writer);
    }
    // 21st should fail
    expect(() =>
      writeWikiFile(wikiDir, 'rate-test-20.md', '# Too many', counter, 'project', bundle.writer)
    ).toThrow('write rate limit exceeded');

    // Clean up
    for (let i = 0; i < 20; i++) {
      rmSync(join(wikiDir, `rate-test-${i}.md`), { force: true });
    }
  });
});

// ============================================================================
// Successful write tests
// ============================================================================

describe('write operations', () => {
  afterEach(() => {
    // Clean up any test files
    for (const name of ['test-write.md', 'sub/nested.md', 'to-remove.md']) {
      const p = join(wikiDir, name);
      if (existsSync(p)) rmSync(p, { force: true });
    }
    const subDir = join(wikiDir, 'sub');
    if (existsSync(subDir)) rmSync(subDir, { recursive: true, force: true });
  });

  it('creates a new file with correct content', () => {
    const result = writeWikiFile(wikiDir, 'test-write.md', '# Hello\n\nWorld.', freshCounter(), 'project', bundle.writer);
    expect(result.path).toBe('test-write.md');
    expect(result.bytes).toBeGreaterThan(0);

    const content = readFileSync(join(wikiDir, 'test-write.md'), 'utf-8');
    expect(content).toBe('# Hello\n\nWorld.');
  });

  it('creates parent directories if needed', () => {
    const result = writeWikiFile(wikiDir, 'sub/nested.md', '# Nested', freshCounter(), 'project', bundle.writer);
    expect(result.path).toBe('sub/nested.md');
    expect(existsSync(join(wikiDir, 'sub', 'nested.md'))).toBe(true);
  });

  it('overwrites an existing file', () => {
    writeWikiFile(wikiDir, 'test-write.md', '# V1', freshCounter(), 'project', bundle.writer);
    writeWikiFile(wikiDir, 'test-write.md', '# V2', freshCounter(), 'project', bundle.writer);

    const content = readFileSync(join(wikiDir, 'test-write.md'), 'utf-8');
    expect(content).toBe('# V2');
  });

  it('atomic write: no tmp files left on success', () => {
    writeWikiFile(wikiDir, 'test-write.md', '# Atomic', freshCounter(), 'project', bundle.writer);
    const files = readdirSync(wikiDir);
    const tmpFiles = files.filter((f) => f.includes('.tmp.'));
    expect(tmpFiles).toEqual([]);
  });
});

// ============================================================================
// Append tests
// ============================================================================

describe('append to log.md', () => {
  it('appends a timestamped entry', () => {
    // Ensure we have a fresh log.md
    const logPath = join(wikiDir, 'log.md');
    const originalContent = readFileSync(logPath, 'utf-8');

    const result = appendWikiLog(wikiDir, 'test append entry', freshCounter(), 'project', bundle.writer);
    expect(result.path).toBe('log.md');
    expect(result.bytes).toBeGreaterThan(0);

    const updated = readFileSync(logPath, 'utf-8');
    expect(updated).toContain('test append entry');
    // Should have ISO timestamp
    expect(updated).toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    // Original content preserved
    expect(updated).toContain(originalContent);
  });

  it('creates log.md if it does not exist', () => {
    const freshWiki = mkdtempSync(join(tmpdir(), 'kg-log-'));
    const freshBundle = openDb(join(freshWiki, 'kg.db'));

    appendWikiLog(freshWiki, 'first entry', freshCounter(), 'project', freshBundle.writer);
    const content = readFileSync(join(freshWiki, 'log.md'), 'utf-8');
    expect(content).toContain('# Turn log');
    expect(content).toContain('first entry');

    closeDb(freshBundle);
    rmSync(freshWiki, { recursive: true, force: true });
  });
});

// ============================================================================
// Remove tests
// ============================================================================

describe('remove wiki file', () => {
  it('deletes a file from disk', () => {
    const target = join(wikiDir, 'to-remove.md');
    writeFileSync(target, '# To be removed');

    const result = removeWikiFile(wikiDir, 'to-remove.md', freshCounter(), 'project', bundle.writer);
    expect(result.removed).toBe(true);
    expect(result.path).toBe('to-remove.md');
    expect(existsSync(target)).toBe(false);
  });

  it('throws if file does not exist', () => {
    expect(() =>
      removeWikiFile(wikiDir, 'nonexistent.md', freshCounter(), 'project', bundle.writer)
    ).toThrow('does not exist');
  });
});

// ============================================================================
// Audit trail test
// ============================================================================

describe('audit trail', () => {
  it('write produces kg_log row with kind "write"', () => {
    const countBefore = nextReader(bundle)
      .prepare<[], { c: number }>(`SELECT count(*) AS c FROM kg_log WHERE kind = 'write'`)
      .get()!.c;

    writeWikiFile(wikiDir, 'audit-test.md', '# Audit', freshCounter(), 'project', bundle.writer);

    const countAfter = nextReader(bundle)
      .prepare<[], { c: number }>(`SELECT count(*) AS c FROM kg_log WHERE kind = 'write'`)
      .get()!.c;

    expect(countAfter).toBe(countBefore + 1);

    rmSync(join(wikiDir, 'audit-test.md'), { force: true });
  });

  it('append produces kg_log row with kind "append"', () => {
    const countBefore = nextReader(bundle)
      .prepare<[], { c: number }>(`SELECT count(*) AS c FROM kg_log WHERE kind = 'append'`)
      .get()!.c;

    appendWikiLog(wikiDir, 'audit entry', freshCounter(), 'project', bundle.writer);

    const countAfter = nextReader(bundle)
      .prepare<[], { c: number }>(`SELECT count(*) AS c FROM kg_log WHERE kind = 'append'`)
      .get()!.c;

    expect(countAfter).toBe(countBefore + 1);
  });

  it('remove produces kg_log row with kind "remove"', () => {
    writeFileSync(join(wikiDir, 'audit-remove.md'), '# To remove');

    const countBefore = nextReader(bundle)
      .prepare<[], { c: number }>(`SELECT count(*) AS c FROM kg_log WHERE kind = 'remove'`)
      .get()!.c;

    removeWikiFile(wikiDir, 'audit-remove.md', freshCounter(), 'project', bundle.writer);

    const countAfter = nextReader(bundle)
      .prepare<[], { c: number }>(`SELECT count(*) AS c FROM kg_log WHERE kind = 'remove'`)
      .get()!.c;

    expect(countAfter).toBe(countBefore + 1);
  });
});

// ============================================================================
// Sandbox integration test
// ============================================================================

describe('sandbox write integration', () => {
  it('kg.project.write() from sandbox creates file on disk', async () => {
    const handler = makeKgExecuteHandler({
      repository, executor, bundle, embedder, wikiRoot: wikiDir,
    });

    const res = await handler({
      code: `return kg.project.write('sandbox-write.md', '# From Sandbox\\n\\nWritten by kg_execute.')`,
    });
    const envelope = parseResponse(res);
    expect(envelope.result).toEqual({ path: 'sandbox-write.md', bytes: expect.any(Number) });

    const content = readFileSync(join(wikiDir, 'sandbox-write.md'), 'utf-8');
    expect(content).toBe('# From Sandbox\n\nWritten by kg_execute.');

    rmSync(join(wikiDir, 'sandbox-write.md'), { force: true });
  });

  it('kg.project.write() rejects path traversal from sandbox', async () => {
    const handler = makeKgExecuteHandler({
      repository, executor, bundle, embedder, wikiRoot: wikiDir,
    });

    const res = await handler({
      code: `try { kg.project.write('../escape.md', '# evil'); return 'LEAKED'; } catch(e) { return String(e); }`,
    });
    const envelope = parseResponse(res);
    // The sandbox binding throws with a path traversal error
    const resultStr = JSON.stringify(envelope.result);
    expect(resultStr).not.toContain('LEAKED');
    expect(resultStr).toMatch(/path.*(traversal|not allowed)/i);
  });

  it('kg.project.remove() from sandbox deletes file', async () => {
    writeFileSync(join(wikiDir, 'sandbox-rm.md'), '# Remove me');

    const handler = makeKgExecuteHandler({
      repository, executor, bundle, embedder, wikiRoot: wikiDir,
    });

    const res = await handler({
      code: `return kg.project.remove('sandbox-rm.md')`,
    });
    const envelope = parseResponse(res);
    expect(envelope.result).toEqual({ path: 'sandbox-rm.md', removed: true });
    expect(existsSync(join(wikiDir, 'sandbox-rm.md'))).toBe(false);
  });
});

// ============================================================================
// Write + re-ingest integration test (Phase 4.5 exit gate)
// ============================================================================

describe('write + re-ingest round-trip', () => {
  it('written file is indexed after ingest (node + chunks in DB)', async () => {
    // Step 1: write a file via the sandbox binding
    const handler = makeKgExecuteHandler({
      repository, executor, bundle, embedder, wikiRoot: wikiDir,
    });

    const content = '# Integration Test\n\n## Section A\n\nThis is a test of the write-then-ingest pipeline.\n\n## Section B\n\nSecond section with distinct content about database indexing.\n';
    const res = await handler({
      code: `return kg.project.write('ingest-roundtrip.md', ${JSON.stringify(content)})`,
    });
    const envelope = parseResponse(res);
    expect(envelope.result.path).toBe('ingest-roundtrip.md');

    // Step 2: manually trigger ingest (in production chokidar does this)
    const ingester = new IngesterService(bundle, embedder, 'project', wikiDir);
    await ingester.ingestFile(join(wikiDir, 'ingest-roundtrip.md'));

    // Step 3: verify nodes + chunks appear in DB
    const reader = nextReader(bundle);
    const sourceUri = 'ingest-roundtrip.md';
    const nodes = reader
      .prepare<[string], { id: string; section_path: string }>(
        `SELECT id, section_path FROM kg_nodes WHERE source_uri = ?`
      )
      .all(sourceUri);
    expect(nodes.length).toBeGreaterThanOrEqual(1);

    const chunks = reader
      .prepare<[string], { id: string; text: string }>(
        `SELECT c.id, c.text FROM kg_chunks c JOIN kg_nodes n ON c.node_id = n.id WHERE n.source_uri = ?`
      )
      .all(sourceUri);
    expect(chunks.length).toBeGreaterThanOrEqual(1);
    expect(chunks.some((c) => c.text.includes('write-then-ingest'))).toBe(true);

    // Step 4: verify the written content is queryable via FTS
    const ftsHits = reader
      .prepare<[string, number], { id: string }>(
        `SELECT c.id FROM kg_chunks_fts f
         JOIN kg_chunks c ON c.rowid = f.rowid
         WHERE kg_chunks_fts MATCH ?
         LIMIT ?`
      )
      .all('"write-then-ingest"', 5);
    expect(ftsHits.length).toBeGreaterThanOrEqual(1);

    // Cleanup
    rmSync(join(wikiDir, 'ingest-roundtrip.md'), { force: true });
  });
});
