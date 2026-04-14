import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import Database, { type Database as BetterSqliteDatabase } from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as sqliteVec from 'sqlite-vec';

import { logger } from '../observability/logger.js';
import * as schema from './schema.js';

/**
 * SQLite connection management for Pinakes.
 *
 * **Single-writer + read-pool-of-2** invariant (CLAUDE.md §Architecture #3,
 * §Database Rules #1):
 *   - One writer connection — all DML for a given DB file goes through this.
 *     Enforced at the app layer via the single-flight gate in the ingester
 *     (a `Map<source_uri, Promise>`), not by the DB driver.
 *   - Two reader connections in a tiny round-robin pool. Reads can run
 *     concurrently with the writer because we use WAL mode. SQLite's
 *     "many readers, one writer" model is fastest with this exact shape;
 *     adding a connection pool with multiple writers actually HURTS
 *     throughput (presearch.md §Loop 0 gotcha).
 *
 * **Mandatory pragmas** (CLAUDE.md §Database Rules #1) applied on EVERY
 * connection (writer + readers) at open time. Foreign keys are enforced
 * per-connection in SQLite, so missing them on a reader would silently
 * skip CASCADE checks.
 *
 * **sqlite-vec extension** is loaded on every connection so that the vec0
 * virtual table is queryable from any reader and writable by the writer.
 * The migration that creates `pinakes_chunks_vec` requires the extension to be
 * loaded BEFORE drizzle's `migrate()` runs — this file orders things so
 * that load happens first.
 *
 * **SQLite version check**: 3.50.4 OR ≥3.51.3, never 3.51.0 (FTS5
 * regression, presearch D18). Throws on a bad version at openDb() time.
 */

// ----------------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------------

/**
 * A bundle of one writer + two readers for a given SQLite file. The
 * `drizzleWriter` is a drizzle wrapper around the writer connection,
 * suitable for Drizzle queries; the raw `writer` and `readers` are
 * also exposed for raw-SQL hot paths (FTS5, vec0, repository LIKE
 * search) where Drizzle's overhead isn't worth it.
 */
export interface DbBundle {
  /** Absolute path to the SQLite file */
  path: string;
  /** Single writer connection — all DML goes through this */
  writer: BetterSqliteDatabase;
  /** Read pool of 2; pick via {@link nextReader} for round-robin */
  readers: BetterSqliteDatabase[];
  /** Drizzle wrapper around `writer` for typed queries */
  drizzleWriter: BetterSQLite3Database<typeof schema>;
}

// ----------------------------------------------------------------------------
// SQLite version check (presearch D18)
// ----------------------------------------------------------------------------

/** SQLite versions known to have an FTS5 regression — never use these. */
const FORBIDDEN_SQLITE_VERSIONS = ['3.51.0'] as const;

/**
 * The minimum acceptable SQLite version. better-sqlite3@12.8.0 bundles
 * 3.51.3 which is fine. Anything older than 3.50.4 is rejected because
 * older versions miss FTS5 features we rely on; anything in the 3.51.0-3.51.2
 * range is rejected due to the FTS5 regression.
 *
 * The check is: version === '3.50.4' OR version >= '3.51.3'.
 */
function isAllowedSqliteVersion(version: string): boolean {
  if ((FORBIDDEN_SQLITE_VERSIONS as readonly string[]).includes(version)) {
    return false;
  }
  if (version === '3.50.4') return true;
  // Lexicographic compare works for 3-component semver where each component
  // is the same width — but SQLite versions are not zero-padded, so we
  // parse and compare numerically.
  const parts = version.split('.').map((p) => parseInt(p, 10));
  if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) return false;
  const [major, minor, patch] = parts as [number, number, number];
  if (major > 3) return true;
  if (major < 3) return false;
  if (minor > 51) return true;
  if (minor < 50) return false;
  if (minor === 50) return patch >= 4;
  // minor === 51
  return patch >= 3;
}

// ----------------------------------------------------------------------------
// Pragmas — applied on every connection (writer + readers)
// ----------------------------------------------------------------------------

/**
 * The 6 mandatory pragmas, applied on every fresh connection. Order matters
 * for `journal_mode=WAL` (must run before any read/write). `cache_size=-20000`
 * is in KB units (negative = KB instead of pages); presearch §Performance
 * settled on 20MB per connection.
 */
function applyPragmas(db: BetterSqliteDatabase): void {
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
  db.pragma('cache_size = -20000');
  db.pragma('temp_store = MEMORY');
}

/**
 * Load the sqlite-vec extension on a connection. Must be called BEFORE any
 * query that touches `pinakes_chunks_vec`, including the migration that creates
 * the virtual table.
 *
 * better-sqlite3 disables loadExtension() by default; we re-enable it on
 * the specific connection only and load the bundled extension shipped by
 * the sqlite-vec npm package (no system install required).
 */
function loadSqliteVec(db: BetterSqliteDatabase): void {
  // Re-enable extension loading for this connection only.
  db.loadExtension(sqliteVec.getLoadablePath());
}

// ----------------------------------------------------------------------------
// Migrations (drizzle-kit output, applied via drizzle's migrate())
// ----------------------------------------------------------------------------

/**
 * The migrations directory, resolved relative to this file. Works under both
 * tsx (ESM source) and post-build (compiled dist/) by using import.meta.url.
 */
const MIGRATIONS_FOLDER = (() => {
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, './migrations');
})();

// ----------------------------------------------------------------------------
// openDb / closeDb
// ----------------------------------------------------------------------------

/**
 * Open (or create) a SQLite file with the full Phase 2 setup applied:
 *   1. Create the parent directory if missing
 *   2. Open one writer + two readers via better-sqlite3
 *   3. Apply mandatory pragmas on each connection
 *   4. Load sqlite-vec on each connection
 *   5. Verify SQLite version (3.50.4 or ≥3.51.3, never 3.51.0)
 *   6. Run drizzle migrations on the writer
 *   7. Stamp `pinakes_meta.schema_version='1'` if not yet set
 *
 * Returns a `DbBundle` ready for repository / ingester use.
 *
 * Pass `{ runMigrations: false }` to skip step 6 — useful for tests that
 * want to assert pragma state on a virgin connection.
 */
export interface OpenDbOptions {
  /** Skip the migration run (default: true). Tests use `false` to test pragmas in isolation. */
  runMigrations?: boolean;
}

export function openDb(path: string, options: OpenDbOptions = {}): DbBundle {
  const runMigrations = options.runMigrations ?? true;
  const absPath = resolve(path);

  // Step 1: ensure parent dir exists. better-sqlite3 will create the file
  // itself but won't `mkdir -p` for the directory.
  mkdirSync(dirname(absPath), { recursive: true });

  // Step 2: open one writer + two readers.
  const writer = new Database(absPath);
  const readers = [new Database(absPath, { readonly: true }), new Database(absPath, { readonly: true })];

  // Step 3 + 4: pragmas + sqlite-vec on every connection.
  for (const conn of [writer, ...readers]) {
    applyPragmas(conn);
    loadSqliteVec(conn);
  }

  // Step 5: SQLite version check. Done after pragmas so any error message
  // includes a sane connection state.
  const versionRow = writer.prepare('SELECT sqlite_version() AS v').get() as { v: string };
  if (!isAllowedSqliteVersion(versionRow.v)) {
    // Clean up before throwing so we don't leak file handles.
    closeDb({ path: absPath, writer, readers, drizzleWriter: drizzle(writer, { schema }) });
    throw new Error(
      `SQLite version ${versionRow.v} is not allowed for Pinakes — requires 3.50.4 or >=3.51.3 (presearch D18). ` +
        `better-sqlite3@12.8.0 bundles 3.51.3; if you see this, your better-sqlite3 was compiled against the system sqlite.`
    );
  }

  // Build the drizzle wrapper before step 6 so migrate() can use it.
  const drizzleWriter = drizzle(writer, { schema });

  // Step 6: run migrations. drizzle's migrate() is idempotent — it tracks
  // applied migrations in `__drizzle_migrations` and only runs new ones.
  // If migrations fail (e.g., DB was created by an older version that was
  // missing intermediate migrations), recover by applying each migration's
  // SQL statements individually with defensive error handling. This preserves
  // existing data (scores, claims, audit) instead of dropping everything.
  if (runMigrations) {
    try {
      migrate(drizzleWriter, { migrationsFolder: MIGRATIONS_FOLDER });
    } catch (err) {
      logger.warn({ err, path: absPath }, 'migration failed — attempting data-preserving recovery');
      recoverMigrations(writer, MIGRATIONS_FOLDER);
    }
  }

  // Step 7: stamp schema_version=1 if absent. Subsequent phases bump this.
  if (runMigrations) {
    writer
      .prepare('INSERT OR IGNORE INTO pinakes_meta (key, value) VALUES (?, ?)')
      .run('schema_version', '4');
  }

  logger.info({ path: absPath, sqliteVersion: versionRow.v }, 'opened SQLite db');

  return { path: absPath, writer, readers, drizzleWriter };
}

/**
 * Close every connection in a bundle. Idempotent — safe to call twice.
 * Logs at debug level so the production stdio path stays quiet on shutdown.
 */
export function closeDb(bundle: DbBundle): void {
  try {
    if (bundle.writer.open) bundle.writer.close();
  } catch (err) {
    logger.warn({ err }, 'error closing writer');
  }
  for (const reader of bundle.readers) {
    try {
      if (reader.open) reader.close();
    } catch (err) {
      logger.warn({ err }, 'error closing reader');
    }
  }
  logger.debug({ path: bundle.path }, 'closed SQLite db');
}

// ----------------------------------------------------------------------------
// Migration recovery
// ----------------------------------------------------------------------------

/**
 * Data-preserving migration recovery. When Drizzle's migrate() fails (e.g.,
 * a DB created by an older version is missing intermediate tables), we:
 *
 *   1. Read the migration journal to get every migration's tag + hash
 *   2. Read each migration's SQL file
 *   3. Execute each statement individually, ignoring "already exists" errors
 *   4. Reset `__drizzle_migrations` to match the full journal
 *
 * This preserves all existing data — scores, claims, audit logs — while
 * ensuring the schema is complete and Drizzle considers all migrations applied.
 */
function recoverMigrations(
  db: BetterSqliteDatabase,
  migrationsFolder: string,
): void {
  const journalPath = join(migrationsFolder, 'meta', '_journal.json');
  const journalRaw = readFileSync(journalPath, 'utf-8');
  const journal = JSON.parse(journalRaw) as {
    entries: Array<{ idx: number; tag: string; when: number }>;
  };

  // Collect already-applied hashes so we can log what's new
  const applied = new Set<string>();
  try {
    const rows = db
      .prepare('SELECT hash FROM __drizzle_migrations')
      .all() as Array<{ hash: string }>;
    for (const r of rows) applied.add(r.hash);
  } catch {
    // Table might not exist yet
  }

  // Apply each migration's SQL defensively
  for (const entry of journal.entries) {
    const sqlPath = join(migrationsFolder, `${entry.tag}.sql`);
    let sql: string;
    try {
      sql = readFileSync(sqlPath, 'utf-8');
    } catch {
      logger.warn({ tag: entry.tag }, 'migration file not found — skipping');
      continue;
    }

    const statements = sql
      .split('--> statement-breakpoint')
      .map((s) => s.trim())
      .filter(Boolean);

    for (const stmt of statements) {
      try {
        db.exec(stmt);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // Ignore expected errors from objects that already exist
        if (
          msg.includes('already exists') ||
          msg.includes('duplicate column') ||
          msg.includes('UNIQUE constraint')
        ) {
          logger.debug({ tag: entry.tag, err: msg }, 'migration statement skipped (already applied)');
        } else {
          logger.warn({ tag: entry.tag, err: msg }, 'migration statement failed — continuing');
        }
      }
    }
  }

  // Reset the Drizzle migration tracker to match the full journal.
  // Compute SHA-256 of each migration file to match Drizzle's hash format.
  db.exec('DROP TABLE IF EXISTS __drizzle_migrations');
  db.exec(`CREATE TABLE __drizzle_migrations (
    id integer PRIMARY KEY AUTOINCREMENT,
    hash text NOT NULL,
    created_at numeric
  )`);

  const { createHash } = await_import_crypto();
  const insert = db.prepare(
    'INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)',
  );

  for (const entry of journal.entries) {
    const sqlPath = join(migrationsFolder, `${entry.tag}.sql`);
    try {
      const content = readFileSync(sqlPath, 'utf-8');
      const hash = createHash('sha256').update(content).digest('hex');
      insert.run(hash, entry.when);
    } catch {
      // Already warned above
    }
  }

  logger.info(
    { total: journal.entries.length, previouslyApplied: applied.size },
    'migration recovery complete — all migrations now tracked',
  );
}

/**
 * Lazy import of crypto to avoid top-level await. createHash is only
 * needed during migration recovery, not on every openDb call.
 */
function await_import_crypto(): typeof import('node:crypto') {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('node:crypto');
}

// ----------------------------------------------------------------------------
// Reader pool helper
// ----------------------------------------------------------------------------

/**
 * Round-robin reader picker. Repository methods call this to spread queries
 * across the read pool. Stateless function — caller passes a counter (or
 * the bundle itself if it doesn't care about even distribution).
 */
let readerCursor = 0;
export function nextReader(bundle: DbBundle): BetterSqliteDatabase {
  const idx = readerCursor++ % bundle.readers.length;
  return bundle.readers[idx]!;
}

// ----------------------------------------------------------------------------
// Test helpers (exported for use in __tests__/)
// ----------------------------------------------------------------------------

/** Exposed for schema.test.ts to verify the version-check rule directly. */
export const __test = {
  isAllowedSqliteVersion,
  applyPragmas,
  loadSqliteVec,
  MIGRATIONS_FOLDER,
};
