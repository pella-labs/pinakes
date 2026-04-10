import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { closeDb, openDb, type DbBundle } from '../../db/client.js';
import { CountingEmbedder, getDefaultEmbedder } from '../../retrieval/embedder.js';
import { IngesterService, __resetSingleFlightForTests } from '../../ingest/ingester.js';
import {
  checkConsistency,
  listMarkdownFiles,
  manifestPathFor,
  readManifest,
  writeManifest,
} from '../../ingest/manifest.js';

/**
 * Self-healing tests for KG-MCP.
 *
 * These test the DB cross-validation in checkConsistency — the fix for the
 * scenario where the manifest claims a file is indexed but the DB has no rows
 * (DB recreated, migration dropped tables, crash left manifest ahead of DB).
 */

const __dirname = resolve(fileURLToPath(import.meta.url), '..');
const FIXTURE_DIR = resolve(__dirname, '../fixtures/wiki');

interface TestContext {
  tmp: string;
  wikiDir: string;
  bundle: DbBundle;
  ingester: IngesterService;
  manifestPath: string;
}

describe('self-healing: DB cross-validation in checkConsistency', () => {
  let ctx: TestContext | null = null;

  beforeEach(() => {
    __resetSingleFlightForTests();
    const tmp = mkdtempSync(join(tmpdir(), 'kg-selfheal-'));
    const wikiDir = join(tmp, 'wiki');
    mkdirSync(wikiDir, { recursive: true });
    copyFileSync(join(FIXTURE_DIR, 'auth.md'), join(wikiDir, 'auth.md'));

    const bundle = openDb(join(tmp, 'kg.db'));
    const ingester = new IngesterService(
      bundle,
      new CountingEmbedder(getDefaultEmbedder()),
      'project',
      wikiDir
    );

    ctx = { tmp, wikiDir, bundle, ingester, manifestPath: manifestPathFor(wikiDir) };
  });

  afterEach(() => {
    if (ctx) {
      closeDb(ctx.bundle);
      rmSync(ctx.tmp, { recursive: true, force: true });
      ctx = null;
    }
    __resetSingleFlightForTests();
  });

  it('manifest says indexed but DB has no rows → file flagged as stale', async () => {
    const c = ctx!;
    const path = join(c.wikiDir, 'auth.md');

    // Ingest the file — populates both manifest and DB.
    await c.ingester.ingestFile(path);

    const manifest = readManifest(c.manifestPath);
    expect(manifest.files['auth.md']).toBeDefined();

    // Without DB cross-check: manifest matches disk → not stale.
    const staleWithoutDb = checkConsistency(manifest, c.wikiDir, 'project');
    expect(staleWithoutDb.length).toBe(0);

    // Now delete the DB rows (simulating DB recreation / migration drop).
    // Simulate DB loss: clear vec rows first (no FK cascade for virtual tables),
// then nodes (cascades to chunks).
c.bundle.writer.exec('DELETE FROM kg_chunks_vec');
c.bundle.writer.exec('DELETE FROM kg_nodes');

    // With DB cross-check: manifest says indexed, DB says empty → stale.
    const staleWithDb = checkConsistency(manifest, c.wikiDir, 'project', c.bundle.writer);
    expect(staleWithDb.length).toBe(1);
    expect(staleWithDb[0]).toBe(resolve(path));
  });

  it('manifest entry is cleared on DB divergence so ingester does not noop', async () => {
    const c = ctx!;
    const path = join(c.wikiDir, 'auth.md');

    // Ingest, then nuke DB rows.
    await c.ingester.ingestFile(path);
    const manifest = readManifest(c.manifestPath);
    // Simulate DB loss: clear vec rows first (no FK cascade for virtual tables),
// then nodes (cascades to chunks).
c.bundle.writer.exec('DELETE FROM kg_chunks_vec');
c.bundle.writer.exec('DELETE FROM kg_nodes');

    // checkConsistency mutates the manifest — clears the entry for the stale file.
    checkConsistency(manifest, c.wikiDir, 'project', c.bundle.writer);
    expect(manifest.files['auth.md']).toBeUndefined();

    // Now re-ingest — should NOT noop because the manifest entry was cleared.
    __resetSingleFlightForTests();
    const ingester2 = new IngesterService(
      c.bundle,
      new CountingEmbedder(getDefaultEmbedder()),
      'project',
      c.wikiDir,
      { manifestPath: c.manifestPath }
    );
    // Write the cleared manifest to disk so the new ingester picks it up.
    writeManifest(c.manifestPath, manifest);
    ingester2.reloadManifest();

    const result = await ingester2.ingestFile(path);
    expect(result.noop).toBe(false);
    expect(result.nodes_written).toBeGreaterThan(0);

    // Verify DB now has rows again.
    const count = c.bundle.writer
      .prepare('SELECT COUNT(*) AS cnt FROM kg_nodes')
      .get() as { cnt: number };
    expect(count.cnt).toBeGreaterThan(0);
  });

  it('multiple files: only files missing from DB are flagged', async () => {
    const c = ctx!;

    // Add a second file.
    writeFileSync(
      join(c.wikiDir, 'api.md'),
      '# API Design\n\nREST API conventions.\n'
    );

    const authPath = join(c.wikiDir, 'auth.md');
    const apiPath = join(c.wikiDir, 'api.md');

    // Ingest both files.
    await c.ingester.ingestFile(authPath);
    await c.ingester.ingestFile(apiPath);

    const manifest = readManifest(c.manifestPath);
    expect(Object.keys(manifest.files).length).toBe(2);

    // Delete only auth.md's rows from DB (keep api.md).
    // Clean up vec rows first (no FK cascade for virtual tables).
    const authUri = 'auth.md';
    const authRowids = c.bundle.writer
      .prepare(
        `SELECT c.rowid AS rowid FROM kg_chunks c
         JOIN kg_nodes n ON c.node_id = n.id
         WHERE n.source_uri = ?`
      )
      .all(authUri) as Array<{ rowid: number }>;
    if (authRowids.length > 0) {
      const placeholders = authRowids.map(() => '?').join(',');
      c.bundle.writer
        .prepare(`DELETE FROM kg_chunks_vec WHERE rowid IN (${placeholders})`)
        .run(...authRowids.map((r) => r.rowid));
    }
    c.bundle.writer
      .prepare('DELETE FROM kg_nodes WHERE source_uri = ?')
      .run(authUri);

    // Only auth.md should be flagged as stale.
    const stale = checkConsistency(manifest, c.wikiDir, 'project', c.bundle.writer);
    expect(stale.length).toBe(1);
    expect(stale[0]).toBe(resolve(authPath));
  });

  it('files not in manifest at all are still flagged (existing behavior preserved)', async () => {
    const c = ctx!;

    // Add a new file that was never ingested.
    writeFileSync(
      join(c.wikiDir, 'new-topic.md'),
      '# New Topic\n\nBrand new content.\n'
    );

    const manifest = readManifest(c.manifestPath);
    // new-topic.md is not in the manifest at all.
    expect(manifest.files['new-topic.md']).toBeUndefined();

    // Should be flagged as stale with or without DB cross-check.
    const staleWithoutDb = checkConsistency(manifest, c.wikiDir, 'project');
    const staleWithDb = checkConsistency(manifest, c.wikiDir, 'project', c.bundle.writer);

    const newPath = resolve(join(c.wikiDir, 'new-topic.md'));
    expect(staleWithoutDb).toContain(newPath);
    expect(staleWithDb).toContain(newPath);
  });

  it('full round-trip: stale files are re-ingested and become queryable', async () => {
    const c = ctx!;
    const path = join(c.wikiDir, 'auth.md');

    // Ingest, then nuke DB.
    await c.ingester.ingestFile(path);
    // Simulate DB loss: clear vec rows first (no FK cascade for virtual tables),
// then nodes (cascades to chunks).
c.bundle.writer.exec('DELETE FROM kg_chunks_vec');
c.bundle.writer.exec('DELETE FROM kg_nodes');

    // Simulate what serve.ts startup does: reload manifest, check, re-ingest.
    c.ingester.reloadManifest();
    const manifest = c.ingester.getManifest();
    const stale = checkConsistency(manifest, c.wikiDir, 'project', c.bundle.writer);
    expect(stale.length).toBe(1);

    // Write the cleared manifest so ingester doesn't noop.
    writeManifest(c.manifestPath, manifest);
    c.ingester.reloadManifest();

    // Re-ingest.
    __resetSingleFlightForTests();
    const result = await c.ingester.ingestFile(stale[0]!);
    expect(result.noop).toBe(false);

    // Verify DB has rows and they're queryable via FTS.
    const ftsResults = c.bundle.writer
      .prepare("SELECT COUNT(*) AS cnt FROM kg_chunks_fts WHERE kg_chunks_fts MATCH 'auth'")
      .get() as { cnt: number };
    expect(ftsResults.cnt).toBeGreaterThan(0);
  });
});
