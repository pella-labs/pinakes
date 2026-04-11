import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { closeDb, openDb, type DbBundle } from '../../db/client.js';
import { getDefaultEmbedder, CountingEmbedder } from '../../retrieval/embedder.js';
import {
  IngesterService,
  __resetSingleFlightForTests,
  extractWikilinks,
} from '../../ingest/ingester.js';

/**
 * Wikilink edge extraction tests (D39).
 *
 * Verifies that [[wikilinks]] in markdown content are resolved to
 * kg_edges rows during ingest, making the neighbors() binding useful.
 */

interface TestContext {
  tmp: string;
  wikiDir: string;
  bundle: DbBundle;
  ingester: IngesterService;
}

describe('ingest/edges (D39)', () => {
  let ctx: TestContext | null = null;

  beforeEach(() => {
    __resetSingleFlightForTests();
    const tmp = mkdtempSync(join(tmpdir(), 'kg-edges-'));
    const wikiDir = join(tmp, 'wiki');
    mkdirSync(wikiDir, { recursive: true });
    const bundle = openDb(join(tmp, 'kg.db'));
    const embedder = new CountingEmbedder(getDefaultEmbedder());
    const ingester = new IngesterService(bundle, embedder, 'project', wikiDir);
    ctx = { tmp, wikiDir, bundle, ingester };
  });

  afterEach(() => {
    if (ctx) {
      closeDb(ctx.bundle);
      rmSync(ctx.tmp, { recursive: true, force: true });
      ctx = null;
    }
    __resetSingleFlightForTests();
  });

  it('extracts wikilinks from content', () => {
    const links = extractWikilinks(
      'See [[auth]] for details. Also check [[database|DB docs]] and [[api]].'
    );
    expect(links).toContain('auth');
    expect(links).toContain('database');
    expect(links).toContain('api');
    expect(links).not.toContain('db docs'); // display text, not target
    expect(links.length).toBe(3);
  });

  it('creates edges for resolved wikilinks', async () => {
    const c = ctx!;

    // Create two wiki files that link to each other
    writeFileSync(
      join(c.wikiDir, 'auth.md'),
      '# Authentication\n\nUses [[database]] for credential storage.\n'
    );
    writeFileSync(
      join(c.wikiDir, 'database.md'),
      '# Database\n\nSupports the [[auth]] module.\n'
    );

    // Ingest both files
    await c.ingester.ingestFile(join(c.wikiDir, 'auth.md'));
    await c.ingester.ingestFile(join(c.wikiDir, 'database.md'));

    // Check edges exist
    const edges = c.bundle.writer
      .prepare<[], { src_id: string; dst_id: string; edge_kind: string }>(
        `SELECT e.src_id, e.dst_id, e.edge_kind
         FROM kg_edges e
         JOIN kg_nodes n ON e.src_id = n.id
         WHERE n.scope = 'project'`
      )
      .all();

    // auth.md links to database.md; database.md links to auth.md
    // auth → database edge is created when database.md is ingested
    // (because database.md exists as a node by the time auth re-resolves)
    // Actually: auth.md is ingested first. At that point database.md doesn't exist,
    // so the link is unresolved. Then database.md is ingested — its link to auth
    // resolves because auth.md nodes already exist.
    expect(edges.length).toBeGreaterThanOrEqual(1);
    expect(edges.some((e) => e.edge_kind === 'wikilink')).toBe(true);
  });

  it('unresolved wikilinks produce no edge and no error', async () => {
    const c = ctx!;

    writeFileSync(
      join(c.wikiDir, 'auth.md'),
      '# Authentication\n\nSee [[nonexistent-page]] for more.\n'
    );

    await c.ingester.ingestFile(join(c.wikiDir, 'auth.md'));

    const edges = c.bundle.writer
      .prepare(`SELECT count(*) AS c FROM kg_edges`)
      .get() as { c: number };

    expect(edges.c).toBe(0);
  });

  it('re-ingest is idempotent for edges', async () => {
    const c = ctx!;

    writeFileSync(
      join(c.wikiDir, 'auth.md'),
      '# Authentication\n\nUses [[database]] for storage.\n'
    );
    writeFileSync(
      join(c.wikiDir, 'database.md'),
      '# Database\n\nMain storage layer.\n'
    );

    // Ingest both
    await c.ingester.ingestFile(join(c.wikiDir, 'database.md'));
    await c.ingester.ingestFile(join(c.wikiDir, 'auth.md'));

    const countBefore = (
      c.bundle.writer.prepare(`SELECT count(*) AS c FROM kg_edges`).get() as { c: number }
    ).c;

    // Modify auth.md slightly and re-ingest (will bypass manifest fast path)
    writeFileSync(
      join(c.wikiDir, 'auth.md'),
      '# Authentication\n\nUses [[database]] for storage. Updated.\n'
    );
    await c.ingester.ingestFile(join(c.wikiDir, 'auth.md'));

    const countAfter = (
      c.bundle.writer.prepare(`SELECT count(*) AS c FROM kg_edges`).get() as { c: number }
    ).c;

    // Same number of edges — old edges deleted, same edges re-inserted
    expect(countAfter).toBe(countBefore);
  });

  it('[[term|display]] resolves on term, not display text', async () => {
    const c = ctx!;

    writeFileSync(
      join(c.wikiDir, 'database.md'),
      '# Database\n\nThe main data store.\n'
    );
    writeFileSync(
      join(c.wikiDir, 'api.md'),
      '# API\n\nQueries [[database|the DB layer]] for data.\n'
    );

    await c.ingester.ingestFile(join(c.wikiDir, 'database.md'));
    await c.ingester.ingestFile(join(c.wikiDir, 'api.md'));

    const edges = c.bundle.writer
      .prepare<[], { src_id: string; dst_id: string }>(
        `SELECT src_id, dst_id FROM kg_edges WHERE edge_kind = 'wikilink'`
      )
      .all();

    // api → database edge should exist
    expect(edges.length).toBe(1);
  });
});
