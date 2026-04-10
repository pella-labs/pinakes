import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { closeDb, openDb, type DbBundle } from '../../db/client.js';
import { CountingEmbedder, getDefaultEmbedder } from '../../retrieval/embedder.js';
import { IngesterService, __resetSingleFlightForTests } from '../../ingest/ingester.js';
import {
  checkConsistency,
  manifestPathFor,
  readManifest,
  writeManifest,
} from '../../ingest/manifest.js';

/**
 * Manifest consistency check test for KG-MCP Phase 2.
 *
 * One test, exercising the cold-start crash-recovery surface (PRD test #18):
 *
 *   1. Ingest a file → manifest is written with the correct source_sha + chunk_shas
 *   2. Mutate the manifest on disk so its source_sha is wrong
 *   3. Run `checkConsistency` → the affected file is reported as stale
 *
 * This is the load-bearing test for our pre-v1 sqlite-vec crash recovery
 * (presearch.md F9). If a process dies between COMMIT and writeManifest,
 * the next startup uses this check to enqueue the divergent files for
 * re-ingest.
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

describe('ingest/manifest (Phase 2)', () => {
  let ctx: TestContext | null = null;

  beforeEach(() => {
    __resetSingleFlightForTests();
    const tmp = mkdtempSync(join(tmpdir(), 'kg-manifest-'));
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

  it('manifest consistency check: mutating source_sha → file flagged for rebuild on startup', async () => {
    const c = ctx!;
    const path = join(c.wikiDir, 'auth.md');

    // First ingest: writes the manifest with the file's real source_sha.
    await c.ingester.ingestFile(path);

    const manifest1 = readManifest(c.manifestPath);
    expect(manifest1.files['auth.md']).toBeDefined();
    const realSha = manifest1.files['auth.md']!.source_sha;
    expect(realSha).toMatch(/^[0-9a-f]{40}$/);

    // Sanity: a fresh consistency check finds nothing stale (manifest matches disk)
    const stale1 = checkConsistency(manifest1, c.wikiDir, 'project');
    expect(stale1.length).toBe(0);

    // Now corrupt the manifest's source_sha for that file (simulating either
    // an external file edit OR a crash before writeManifest could persist
    // the new sha after a successful ingest).
    const corrupted = readManifest(c.manifestPath);
    corrupted.files['auth.md']!.source_sha = 'a'.repeat(40); // bogus sha
    writeManifest(c.manifestPath, corrupted);

    // Reload the manifest from disk (simulating a fresh process startup)
    const manifest2 = readManifest(c.manifestPath);
    expect(manifest2.files['auth.md']!.source_sha).toBe('a'.repeat(40));

    // Consistency check now reports the file as stale → it would be enqueued
    // for re-ingest by `kg serve`'s startup check.
    const stale2 = checkConsistency(manifest2, c.wikiDir, 'project');
    expect(stale2.length).toBe(1);
    expect(stale2[0]).toBe(resolve(path));
  });
});
