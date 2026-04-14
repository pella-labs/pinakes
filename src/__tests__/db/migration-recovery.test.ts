import {
  mkdirSync,
  mkdtempSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { closeDb, openDb, type DbBundle } from '../../db/client.js';

describe('migration recovery', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'pinakes-migrate-'));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('fresh DB gets all migrations applied', () => {
    const dbPath = join(tmp, 'fresh.db');
    const bundle = openDb(dbPath);
    try {
      // All tables should exist
      const tables = bundle.writer
        .prepare(
          `SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'pinakes_%' ORDER BY name`,
        )
        .all() as Array<{ name: string }>;

      const names = tables.map((t) => t.name);
      expect(names).toContain('pinakes_nodes');
      expect(names).toContain('pinakes_chunks');
      expect(names).toContain('pinakes_claims');
      expect(names).toContain('pinakes_audit');

      // Claims table should have supersession columns
      const cols = bundle.writer
        .prepare(`PRAGMA table_info(pinakes_claims)`)
        .all() as Array<{ name: string }>;
      const colNames = cols.map((c) => c.name);
      expect(colNames).toContain('version');
      expect(colNames).toContain('superseded_by');
      expect(colNames).toContain('superseded_at');

      // Nodes table should have confidence_score
      const nodeCols = bundle.writer
        .prepare(`PRAGMA table_info(pinakes_nodes)`)
        .all() as Array<{ name: string }>;
      expect(nodeCols.map((c) => c.name)).toContain('confidence_score');
    } finally {
      closeDb(bundle);
    }
  });

  it('recovers when intermediate migration tables are missing', () => {
    const dbPath = join(tmp, 'partial.db');

    // Simulate a DB created by an older version: apply only migrations 0-2
    // (no claims table), then close and reopen with current code.
    const raw = new Database(dbPath);
    raw.pragma('journal_mode = WAL');

    // Create the drizzle migrations tracker with only first 3 migrations
    raw.exec(`CREATE TABLE __drizzle_migrations (
      id integer PRIMARY KEY AUTOINCREMENT,
      hash text NOT NULL,
      created_at numeric
    )`);
    raw.exec(`INSERT INTO __drizzle_migrations (hash, created_at) VALUES ('hash0', 1775710703850)`);
    raw.exec(`INSERT INTO __drizzle_migrations (hash, created_at) VALUES ('hash1', 1775768662604)`);
    raw.exec(`INSERT INTO __drizzle_migrations (hash, created_at) VALUES ('hash2', 1776192000000)`);

    // Create only the tables from migrations 0-2 (no claims, no confidence_score)
    raw.exec(`CREATE TABLE pinakes_meta (key TEXT PRIMARY KEY, value TEXT)`);
    raw.exec(`CREATE TABLE pinakes_nodes (
      id TEXT PRIMARY KEY, scope TEXT NOT NULL, source_uri TEXT NOT NULL,
      section_path TEXT NOT NULL DEFAULT '/', kind TEXT NOT NULL DEFAULT 'section',
      title TEXT, content TEXT NOT NULL, source_sha TEXT NOT NULL,
      token_count INTEGER NOT NULL DEFAULT 0,
      confidence TEXT NOT NULL DEFAULT 'extracted',
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
      last_accessed_at INTEGER NOT NULL
    )`);
    raw.exec(`CREATE TABLE pinakes_chunks (
      id TEXT PRIMARY KEY, node_id TEXT NOT NULL REFERENCES pinakes_nodes(id) ON DELETE CASCADE,
      chunk_index INTEGER NOT NULL, text TEXT NOT NULL,
      chunk_sha TEXT NOT NULL, token_count INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    )`);
    raw.exec(`CREATE TABLE pinakes_edges (
      src_id TEXT NOT NULL, dst_id TEXT NOT NULL, edge_kind TEXT NOT NULL,
      PRIMARY KEY (src_id, dst_id, edge_kind)
    )`);
    raw.exec(`CREATE TABLE pinakes_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL,
      scope TEXT NOT NULL, kind TEXT NOT NULL, source_uri TEXT,
      payload TEXT
    )`);
    raw.exec(`CREATE TABLE pinakes_gaps (
      id INTEGER PRIMARY KEY AUTOINCREMENT, scope TEXT NOT NULL,
      topic TEXT NOT NULL, first_seen_at INTEGER NOT NULL,
      mentions_count INTEGER NOT NULL DEFAULT 1, resolved_at INTEGER
    )`);
    raw.exec(`CREATE TABLE pinakes_audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      tool_name TEXT NOT NULL, scope_requested TEXT NOT NULL,
      caller_ctx TEXT, response_tokens INTEGER, error TEXT
    )`);

    // Insert some test data that should survive recovery
    const now = Date.now();
    raw.exec(`INSERT INTO pinakes_nodes (id, scope, source_uri, section_path, kind, content, source_sha, token_count, confidence, created_at, updated_at, last_accessed_at) VALUES ('test-node', 'project', 'test.md', '/', 'section', 'test content', 'sha123', 10, 'extracted', ${now}, ${now}, ${now})`);

    raw.close();

    // Now open with current code — should recover, not crash
    const bundle = openDb(dbPath);
    try {
      // The test node should survive
      const node = bundle.writer
        .prepare(`SELECT id, content FROM pinakes_nodes WHERE id = 'test-node'`)
        .get() as { id: string; content: string } | undefined;
      expect(node).toBeDefined();
      expect(node!.content).toBe('test content');

      // Claims table should now exist with supersession columns
      const cols = bundle.writer
        .prepare(`PRAGMA table_info(pinakes_claims)`)
        .all() as Array<{ name: string }>;
      const colNames = cols.map((c) => c.name);
      expect(colNames).toContain('version');
      expect(colNames).toContain('superseded_by');

      // confidence_score column should be added to nodes
      const nodeCols = bundle.writer
        .prepare(`PRAGMA table_info(pinakes_nodes)`)
        .all() as Array<{ name: string }>;
      expect(nodeCols.map((c) => c.name)).toContain('confidence_score');

      // All migrations should be tracked
      const migrations = bundle.writer
        .prepare('SELECT COUNT(*) as cnt FROM __drizzle_migrations')
        .get() as { cnt: number };
      expect(migrations.cnt).toBeGreaterThanOrEqual(6);
    } finally {
      closeDb(bundle);
    }
  });
});
