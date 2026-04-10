import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { closeDb, openDb } from '../../db/client.js';
import { rebuildCommand } from '../../cli/rebuild.js';
import { CountingEmbedder, getDefaultEmbedder } from '../../retrieval/embedder.js';
import { __resetSingleFlightForTests } from '../../ingest/ingester.js';

/**
 * `kg rebuild` CLI tests for KG-MCP Phase 2.
 *
 * Three tests:
 *   1. Rebuild against the fixture wiki populates all 8 tables and completes
 *      in <10s (PRD acceptance criteria #1 + #5)
 *   2. sqlite-vec virtual table accepts a 384-dim Float32Array insert (PRD #9)
 *      — verified by counting kg_chunks_vec rows after rebuild
 *   3. FTS5 virtual table populates on chunk insert (PRD #8) — verified by
 *      MATCH-querying for "hashpassword" and getting ≥1 result
 */

const __dirname = resolve(fileURLToPath(import.meta.url), '..');
const FIXTURE_DIR = resolve(__dirname, '../fixtures/wiki');

interface TestContext {
  tmp: string;
  wikiDir: string;
  dbPath: string;
}

describe('cli/rebuild (Phase 2)', () => {
  let ctx: TestContext | null = null;

  beforeEach(() => {
    __resetSingleFlightForTests();
    const tmp = mkdtempSync(join(tmpdir(), 'kg-rebuild-'));
    const wikiDir = join(tmp, 'wiki');
    mkdirSync(wikiDir, { recursive: true });

    // Copy all 3 fixtures into the temp wiki dir
    for (const name of readdirSync(FIXTURE_DIR)) {
      copyFileSync(join(FIXTURE_DIR, name), join(wikiDir, name));
    }

    ctx = { tmp, wikiDir, dbPath: join(tmp, 'kg.db') };
  });

  afterEach(() => {
    if (ctx) {
      rmSync(ctx.tmp, { recursive: true, force: true });
      ctx = null;
    }
    __resetSingleFlightForTests();
  });

  it(
    'rebuild against the fixture populates all 8 tables and completes in <10s',
    async () => {
      const c = ctx!;

      const t0 = Date.now();
      const summaries = await rebuildCommand({
        wikiPath: c.wikiDir,
        dbPath: c.dbPath,
        scope: 'project', // skip personal — fixture is project-only
        embedder: new CountingEmbedder(getDefaultEmbedder()),
      });
      const elapsed = Date.now() - t0;

      // PRD #5: <10s on fixture data
      expect(elapsed).toBeLessThan(10_000);

      expect(summaries.length).toBe(1);
      const project = summaries[0]!;
      expect(project.scope).toBe('project');
      expect(project.files).toBe(3); // auth.md, database.md, log.md
      expect(project.nodes).toBeGreaterThanOrEqual(3);
      expect(project.chunks_added).toBeGreaterThan(0);
      expect(project.embedder_calls).toBe(project.chunks_added);

      // Verify row counts directly against the DB
      const bundle = openDb(c.dbPath);
      try {
        const tableCounts = (table: string): number =>
          (bundle.writer.prepare(`SELECT count(*) AS c FROM ${table}`).get() as { c: number }).c;

        expect(tableCounts('kg_meta')).toBeGreaterThanOrEqual(1); // schema_version
        expect(tableCounts('kg_nodes')).toBeGreaterThanOrEqual(3);
        expect(tableCounts('kg_chunks')).toBe(project.chunks_added);
        expect(tableCounts('kg_chunks_fts')).toBe(project.chunks_added);
        expect(tableCounts('kg_chunks_vec')).toBe(project.chunks_added);
        expect(tableCounts('kg_log')).toBeGreaterThanOrEqual(3); // one per ingest
        // kg_edges, kg_audit are created but not written by Phase 2
        // kg_gaps may be populated by Phase 6 gap detection during ingest
        expect(tableCounts('kg_edges')).toBe(0);
        expect(tableCounts('kg_gaps')).toBeGreaterThanOrEqual(0);
        expect(tableCounts('kg_audit')).toBe(0);
      } finally {
        closeDb(bundle);
      }
    },
    30_000 // generous timeout for first run + embedder warmup
  );

  it(
    'sqlite-vec virtual table accepts 384-dim Float32Array inserts',
    async () => {
      const c = ctx!;
      await rebuildCommand({
        wikiPath: c.wikiDir,
        dbPath: c.dbPath,
        scope: 'project',
        embedder: new CountingEmbedder(getDefaultEmbedder()),
      });

      const bundle = openDb(c.dbPath);
      try {
        const vecCount = bundle.writer
          .prepare('SELECT count(*) AS c FROM kg_chunks_vec')
          .get() as { c: number };
        expect(vecCount.c).toBeGreaterThan(0);

        const chunkCount = bundle.writer
          .prepare('SELECT count(*) AS c FROM kg_chunks')
          .get() as { c: number };

        // One vec row per chunk row — the ingester always pairs them
        expect(vecCount.c).toBe(chunkCount.c);

        // Direct test of sqlite-vec accepting an arbitrary 384-dim insert.
        // The rowid MUST be a BigInt — sqlite-vec rejects JS Numbers for the
        // rowid binding (verified via repro 2026-04-09; see ingester.ts).
        const buf = Buffer.alloc(384 * 4);
        const f32 = new Float32Array(buf.buffer, buf.byteOffset, 384);
        for (let i = 0; i < 384; i++) f32[i] = i / 384;

        bundle.writer
          .prepare('INSERT INTO kg_chunks_vec(rowid, embedding) VALUES (?, ?)')
          .run(BigInt(999999), buf);

        const after = bundle.writer
          .prepare('SELECT count(*) AS c FROM kg_chunks_vec')
          .get() as { c: number };
        expect(after.c).toBe(vecCount.c + 1);
      } finally {
        closeDb(bundle);
      }
    },
    30_000
  );

  it(
    'FTS5 virtual table populates on chunk insert (queryable via MATCH)',
    async () => {
      const c = ctx!;
      await rebuildCommand({
        wikiPath: c.wikiDir,
        dbPath: c.dbPath,
        scope: 'project',
        embedder: new CountingEmbedder(getDefaultEmbedder()),
      });

      const bundle = openDb(c.dbPath);
      try {
        // FTS5 tokenizer is unicode61 + remove_diacritics 2 — case-insensitive,
        // splits on word boundaries. "hashPassword" tokenizes to "hashpassword"
        // (single token, not split on case).
        const hits = bundle.writer
          .prepare(
            "SELECT count(*) AS c FROM kg_chunks_fts WHERE kg_chunks_fts MATCH 'hashpassword'"
          )
          .get() as { c: number };
        expect(hits.c).toBeGreaterThanOrEqual(1);

        // bcrypt also lives in auth.md — same fixture content the spike tests use
        const bcryptHits = bundle.writer
          .prepare("SELECT count(*) AS c FROM kg_chunks_fts WHERE kg_chunks_fts MATCH 'bcrypt'")
          .get() as { c: number };
        expect(bcryptHits.c).toBeGreaterThanOrEqual(1);

        // FTS5 row count matches kg_chunks row count (the trigger keeps them in sync)
        const ftsTotal = bundle.writer
          .prepare('SELECT count(*) AS c FROM kg_chunks_fts')
          .get() as { c: number };
        const chunkTotal = bundle.writer
          .prepare('SELECT count(*) AS c FROM kg_chunks')
          .get() as { c: number };
        expect(ftsTotal.c).toBe(chunkTotal.c);
      } finally {
        closeDb(bundle);
      }
    },
    30_000
  );
});
