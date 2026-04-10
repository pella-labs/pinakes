import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { closeDb, openDb, __test, type DbBundle } from '../../db/client.js';
import { KG_TABLES, KG_VIRTUAL_TABLES } from '../../db/schema.js';

/**
 * Schema/DB tests — Phase 2 first wave.
 *
 * These tests verify the load-bearing invariants of the storage layer:
 *   1. Migration up creates every expected table (regular + virtual)
 *   2. All 6 mandatory pragmas are applied on every connection
 *   3. SQLite version is in the allowed set (3.50.4 or >=3.51.3, never 3.51.0)
 *   4. Idempotent upsert: writing the same node twice → 1 row
 *   5. FK cascade: deleting a node cleans up its chunks + edges
 *
 * Each test gets a fresh tmpdir + DB file so they don't interfere. The
 * tmpdir is removed in afterEach.
 */
describe('db/schema (Phase 2)', () => {
  let tmp: string;
  let bundle: DbBundle | null = null;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'kg-schema-'));
  });

  afterEach(() => {
    if (bundle) {
      closeDb(bundle);
      bundle = null;
    }
    rmSync(tmp, { recursive: true, force: true });
  });

  it('migration up creates all 9 expected tables (7 regular + 2 virtual)', () => {
    bundle = openDb(join(tmp, 'kg.db'));
    const rows = bundle.writer
      .prepare("SELECT name FROM sqlite_master WHERE type IN ('table') ORDER BY name")
      .all() as Array<{ name: string }>;
    const names = rows.map((r) => r.name);

    // Every expected regular table must be present.
    for (const expected of KG_TABLES) {
      expect(names).toContain(expected);
    }
    // Every expected virtual table must be present (FTS5 + sqlite-vec).
    for (const expected of KG_VIRTUAL_TABLES) {
      expect(names).toContain(expected);
    }
  });

  it('applies all 6 mandatory pragmas on every connection (writer + readers)', () => {
    bundle = openDb(join(tmp, 'kg.db'));
    const expected: Array<[string, unknown]> = [
      // journal_mode pragma returns the mode as a string row
      ['journal_mode', 'wal'],
      ['busy_timeout', 5000],
      // synchronous returns 1 for NORMAL
      ['synchronous', 1],
      ['foreign_keys', 1],
      // cache_size negative = KB count; -20000 means 20MB cache
      ['cache_size', -20000],
      // temp_store: 0=DEFAULT, 1=FILE, 2=MEMORY
      ['temp_store', 2],
    ];

    for (const conn of [bundle.writer, ...bundle.readers]) {
      for (const [pragma, expectedValue] of expected) {
        const row = conn.pragma(pragma, { simple: true });
        expect(row, `pragma ${pragma} on connection`).toBe(expectedValue);
      }
    }
  });

  it('SQLite version is in the allowed set (3.50.4 or >=3.51.3, never 3.51.0)', () => {
    bundle = openDb(join(tmp, 'kg.db'));
    const row = bundle.writer.prepare('SELECT sqlite_version() AS v').get() as { v: string };

    expect(__test.isAllowedSqliteVersion(row.v)).toBe(true);
    // Verify the version-check rules directly with synthetic versions:
    expect(__test.isAllowedSqliteVersion('3.51.0')).toBe(false); // FTS5 regression
    expect(__test.isAllowedSqliteVersion('3.51.1')).toBe(false);
    expect(__test.isAllowedSqliteVersion('3.51.2')).toBe(false);
    expect(__test.isAllowedSqliteVersion('3.51.3')).toBe(true);
    expect(__test.isAllowedSqliteVersion('3.51.4')).toBe(true);
    expect(__test.isAllowedSqliteVersion('3.50.4')).toBe(true);
    expect(__test.isAllowedSqliteVersion('3.50.3')).toBe(false); // too old
    expect(__test.isAllowedSqliteVersion('3.52.0')).toBe(true);
    expect(__test.isAllowedSqliteVersion('4.0.0')).toBe(true);
    expect(__test.isAllowedSqliteVersion('not.a.version')).toBe(false);
  });

  it('idempotent upsert: writing the same node twice → 1 row', () => {
    bundle = openDb(join(tmp, 'kg.db'));
    const now = Date.now();
    const insert = bundle.writer.prepare(
      `INSERT INTO kg_nodes (id, scope, source_uri, section_path, kind, title, content, source_sha, token_count, created_at, updated_at, last_accessed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         content = excluded.content,
         source_sha = excluded.source_sha,
         token_count = excluded.token_count,
         updated_at = excluded.updated_at,
         last_accessed_at = excluded.last_accessed_at`
    );

    const args = [
      'deadbeef',
      'project',
      'file:///x.md',
      'Auth / Login',
      'section',
      'Login',
      'first content',
      'sha-v1',
      10,
      now,
      now,
      now,
    ] as const;

    insert.run(...args);
    insert.run(...args); // same id, idempotent
    insert.run(
      'deadbeef',
      'project',
      'file:///x.md',
      'Auth / Login',
      'section',
      'Login',
      'updated content',
      'sha-v2',
      11,
      now,
      now + 100,
      now + 100
    );

    const rows = bundle.writer
      .prepare('SELECT id, content, source_sha FROM kg_nodes WHERE id = ?')
      .all('deadbeef') as Array<{ id: string; content: string; source_sha: string }>;

    expect(rows.length).toBe(1);
    expect(rows[0]!.content).toBe('updated content');
    expect(rows[0]!.source_sha).toBe('sha-v2');
  });

  it('FK cascade: deleting a node deletes its chunks + edges', () => {
    bundle = openDb(join(tmp, 'kg.db'));
    const now = Date.now();
    const w = bundle.writer;

    // Insert two nodes + two chunks (one per node) + one edge.
    const insertNode = w.prepare(
      `INSERT INTO kg_nodes (id, scope, source_uri, section_path, kind, title, content, source_sha, token_count, created_at, updated_at, last_accessed_at)
       VALUES (?, 'project', 'file:///x.md', '', 'section', NULL, ?, 'sha', 1, ?, ?, ?)`
    );
    insertNode.run('node-A', 'A content', now, now, now);
    insertNode.run('node-B', 'B content', now, now, now);

    const insertChunk = w.prepare(
      `INSERT INTO kg_chunks (id, node_id, chunk_index, text, chunk_sha, token_count, created_at)
       VALUES (?, ?, 0, ?, ?, 1, ?)`
    );
    insertChunk.run('chunk-A', 'node-A', 'A chunk', 'sha-A', now);
    insertChunk.run('chunk-B', 'node-B', 'B chunk', 'sha-B', now);

    w.prepare(
      `INSERT INTO kg_edges (src_id, dst_id, edge_kind) VALUES (?, ?, 'wikilink')`
    ).run('node-A', 'node-B');

    // Sanity: everything is there.
    expect((w.prepare('SELECT count(*) AS c FROM kg_nodes').get() as { c: number }).c).toBe(2);
    expect((w.prepare('SELECT count(*) AS c FROM kg_chunks').get() as { c: number }).c).toBe(2);
    expect((w.prepare('SELECT count(*) AS c FROM kg_edges').get() as { c: number }).c).toBe(1);

    // Delete node-A — should cascade to chunk-A and the edge from A to B.
    w.prepare('DELETE FROM kg_nodes WHERE id = ?').run('node-A');

    expect((w.prepare('SELECT count(*) AS c FROM kg_nodes').get() as { c: number }).c).toBe(1);
    expect((w.prepare('SELECT count(*) AS c FROM kg_chunks').get() as { c: number }).c).toBe(1);
    expect((w.prepare('SELECT count(*) AS c FROM kg_edges').get() as { c: number }).c).toBe(0);

    // The remaining chunk belongs to node-B.
    const survivor = w.prepare('SELECT node_id FROM kg_chunks').get() as { node_id: string };
    expect(survivor.node_id).toBe('node-B');
  });
});
