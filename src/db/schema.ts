import { sql } from 'drizzle-orm';
import { sqliteTable, text, integer, index, primaryKey } from 'drizzle-orm/sqlite-core';

/**
 * KG-MCP Drizzle schema (presearch.md §2.3, CLAUDE.md §Database Rules).
 *
 * 8 logical tables + `kg_meta` for schema versioning. Two of the eight are
 * virtual tables (`kg_chunks_fts`, `kg_chunks_vec`) that drizzle-kit can't
 * model — they're created via raw SQL appended to the initial migration in
 * src/db/migrations. The drizzle code below covers the 7 regular tables
 * plus kg_meta.
 *
 * Invariants this schema MUST preserve:
 *
 * - `kg_nodes.id` is `sha1(scope + ':' + source_uri + ':' + section_path)`,
 *   set by the ingester (NOT auto-generated). Re-ingesting the same
 *   markdown produces identical ids — Phase 2's idempotent upsert relies
 *   on this. The DB never sees the hashing logic; it just stores the value
 *   and enforces uniqueness via the PK.
 *
 * - `kg_chunks.id` is `sha1(node_id + ':' + chunk_index)`, same idea.
 *
 * - `chunk_sha = sha1(chunk_text)` is the LOAD-BEARING field for the
 *   per-chunk skip-unchanged optimization (CLAUDE.md §Database Rules #3,
 *   Loop 6.5 A4). On a Pharos wiki-updater whole-file rewrite we look up
 *   the existing chunk_shas for the file's nodes and only re-embed chunks
 *   whose sha changed. Without this, every turn re-embeds 60 chunks ×
 *   ~50ms = 3s of blocking work that competes with the active coding LLM
 *   for Ollama. Do not remove this column.
 *
 * - `last_accessed_at` on `kg_nodes` exists for the Phase 5 personal-KG
 *   LRU eviction (Loop 6.5 A2). Phase 2 just stamps it on insert/update.
 *
 * - `source_sha` on `kg_nodes` is the file-level hash; staleness detection
 *   on the query path compares this against the current on-disk hash.
 *
 * - All FK relationships use `ON DELETE CASCADE` so deleting a node cleans
 *   up its chunks and edges in one statement (verified by schema test #5).
 *   Foreign keys are enforced via PRAGMA foreign_keys=ON, mandatory on
 *   every connection in client.ts.
 */

// ----------------------------------------------------------------------------
// kg_meta — schema versioning + bookkeeping
// ----------------------------------------------------------------------------

/**
 * Tiny key/value table holding `schema_version`, `last_full_rebuild`, and
 * any other one-off bookkeeping. Sized for handfuls of rows.
 *
 * Stamped at first openDb() call by client.ts if absent. The schema_version
 * value lets us detect drift on startup and either run new migrations or
 * (in the worst case for sqlite-vec breaking changes) drop + rebuild the
 * vec virtual table from markdown.
 */
export const kgMeta = sqliteTable('kg_meta', {
  key: text('key').primaryKey(),
  value: text('value'),
});

// ----------------------------------------------------------------------------
// kg_nodes — markdown sections + concept entities (Phase 2 only writes
// kind='section' rows; Phase 4 adds entities, Phase 6 adds gaps)
// ----------------------------------------------------------------------------

/**
 * One row per markdown section. The "primary unit" of the KG — chunks belong
 * to nodes, edges connect nodes.
 *
 * `kind` is open-ended for forward compatibility:
 *   - `'section'` — the only kind Phase 2 writes; one per ATX heading
 *   - `'entity' | 'concept' | 'decision' | 'log_entry' | 'gap'` — Phase 4-6
 *
 * `section_path` is the ATX heading hierarchy joined by ` / ` (e.g.
 * `"Authentication / Login flow"` for an `## Login flow` under `# Authentication`).
 * Empty string for top-of-file content above any heading.
 *
 * `content` stores the full section markdown (heading + body). Chunks are
 * derived from this and stored separately in kg_chunks. We keep both because
 * `kg_execute` callers may want the whole section (`kg.get(node_id)`) instead
 * of paragraph-sized chunks.
 */
export const kgNodes = sqliteTable(
  'kg_nodes',
  {
    /** sha1(scope + ':' + source_uri + ':' + section_path), set by ingester */
    id: text('id').primaryKey(),
    /** 'project' | 'personal' — enforced at app layer, not as a CHECK */
    scope: text('scope').notNull(),
    /** Relative path from wiki root (project scope) or file:// URL (personal scope) */
    sourceUri: text('source_uri').notNull(),
    /** Heading hierarchy joined by ' / '; empty string for pre-heading content */
    sectionPath: text('section_path').notNull(),
    /** 'section' for Phase 2; widens in Phase 4+ */
    kind: text('kind').notNull().default('section'),
    /** Heading text (H1/H2/H3 string), null for pre-heading content */
    title: text('title'),
    /** Full section markdown (heading + body) */
    content: text('content').notNull(),
    /** sha1 of the entire source file (for staleness detection) */
    sourceSha: text('source_sha').notNull(),
    /** Cached token count of `content` for fast budget math */
    tokenCount: integer('token_count').notNull(),
    /** Provenance confidence: 'extracted' (default), 'inferred' (AI-generated), 'ambiguous' (flagged) */
    confidence: text('confidence').notNull().default('extracted'),
    /** Unix epoch ms of first insert */
    createdAt: integer('created_at').notNull(),
    /** Unix epoch ms of last update */
    updatedAt: integer('updated_at').notNull(),
    /** Unix epoch ms of last read access — Phase 5 LRU eviction (Loop 6.5 A2) */
    lastAccessedAt: integer('last_accessed_at').notNull(),
  },
  (t) => [
    index('idx_kg_nodes_scope_uri').on(t.scope, t.sourceUri),
    index('idx_kg_nodes_last_accessed').on(t.lastAccessedAt),
  ]
);

// ----------------------------------------------------------------------------
// kg_edges — wikilinks, citations, supersedes, etc. (Phase 4+ writes; Phase 2
// just creates the table for migration completeness)
// ----------------------------------------------------------------------------

/**
 * Directed edges between nodes. Composite primary key on
 * `(src_id, dst_id, edge_kind)` so the same pair can have multiple edge
 * kinds (e.g. one node both `cites` and `supersedes` another).
 *
 * Phase 2 doesn't populate this table — Phase 4 extracts wikilinks during
 * markdown parsing. The table exists now so the migration is complete and
 * Phase 4 doesn't have to add it as a separate migration.
 */
export const kgEdges = sqliteTable(
  'kg_edges',
  {
    srcId: text('src_id')
      .notNull()
      .references(() => kgNodes.id, { onDelete: 'cascade' }),
    dstId: text('dst_id')
      .notNull()
      .references(() => kgNodes.id, { onDelete: 'cascade' }),
    /** 'wikilink' | 'cites' | 'supersedes' | 'contradicts' | 'mentions' | 'derived_from' */
    edgeKind: text('edge_kind').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.srcId, t.dstId, t.edgeKind] }),
    index('idx_kg_edges_src').on(t.srcId),
    index('idx_kg_edges_dst').on(t.dstId),
  ]
);

// ----------------------------------------------------------------------------
// kg_chunks — paragraph-level splits of nodes
// ----------------------------------------------------------------------------

/**
 * One row per ~500-token chunk derived from a node's `content`. The
 * chunker (src/ingest/parse/chunk.ts) splits on paragraph boundaries and
 * accumulates until adding the next paragraph would exceed `target_tokens`.
 *
 * The implicit SQLite `rowid` (auto-assigned for tables without
 * INTEGER PRIMARY KEY) is what FTS5 and sqlite-vec join on:
 *   - `kg_chunks_fts` is `content='kg_chunks', content_rowid='rowid'`
 *   - `kg_chunks_vec.rowid` matches `kg_chunks.rowid`
 *
 * `chunk_sha = sha1(text)` is the per-chunk skip-unchanged key. On a
 * file rewrite, the ingester compares each new chunk's chunk_sha against
 * the existing chunk_shas for the file's nodes; matching chunks reuse
 * the existing embedding (no embedder call), only changed chunks get
 * re-embedded. This is the load-bearing optimization for Pharos's
 * whole-file-rewrite-per-turn pattern (CLAUDE.md §Database Rules #3).
 */
export const kgChunks = sqliteTable(
  'kg_chunks',
  {
    /** sha1(node_id + ':' + chunk_index) */
    id: text('id').primaryKey(),
    /** FK to kg_nodes; cascade-delete cleans up chunks when a node goes away */
    nodeId: text('node_id')
      .notNull()
      .references(() => kgNodes.id, { onDelete: 'cascade' }),
    /** 0-based position within the node's chunk list */
    chunkIndex: integer('chunk_index').notNull(),
    /** The chunk's text content */
    text: text('text').notNull(),
    /** sha1(text) — load-bearing for per-chunk skip-unchanged */
    chunkSha: text('chunk_sha').notNull(),
    /** Cached token count for fast budget math */
    tokenCount: integer('token_count').notNull(),
    /** Unix epoch ms of insert */
    createdAt: integer('created_at').notNull(),
  },
  (t) => [index('idx_kg_chunks_node').on(t.nodeId)]
);

// ----------------------------------------------------------------------------
// kg_log — append-only event log (Karpathy log.md materialized)
// ----------------------------------------------------------------------------

/**
 * Append-only event stream. Phase 2 writes:
 *   - `'ingest:done'` — successful file ingest
 *   - `'ingest:error'` — failed file ingest
 *   - `'rebuild:start' | 'rebuild:done'` — full-rebuild markers
 *
 * `payload` is opaque JSON shaped per `kind`. The reader is the LLM via
 * `kg.log.recent(n, opts)` in Phase 4+; Phase 2 just appends.
 */
export const kgLog = sqliteTable(
  'kg_log',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    /** Unix epoch ms */
    ts: integer('ts').notNull(),
    /** 'project' | 'personal' */
    scope: text('scope').notNull(),
    /** Event kind, e.g. 'ingest:done' */
    kind: text('kind').notNull(),
    /** Source URI for ingest events; null for non-file events */
    sourceUri: text('source_uri'),
    /** Opaque JSON payload, shape per `kind` */
    payload: text('payload'),
  },
  (t) => [index('idx_kg_log_ts').on(sql`${t.ts} DESC`)]
);

// ----------------------------------------------------------------------------
// kg_gaps — detected concept gaps (Phase 6+ writes; Phase 2 creates table)
// ----------------------------------------------------------------------------

/**
 * Concept gaps detected by the Phase 6 gap-detection sub-agent. Phase 2
 * creates the table; Phase 6 wires the writes.
 *
 * `mentions_count` lets the dashboard prioritize gaps that appear across
 * multiple turns. `resolved_at` is set when a gap is closed (either by
 * the LLM writing about the topic or by a manual dismissal).
 */
export const kgGaps = sqliteTable('kg_gaps', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  scope: text('scope').notNull(),
  topic: text('topic').notNull(),
  firstSeenAt: integer('first_seen_at').notNull(),
  mentionsCount: integer('mentions_count').notNull().default(1),
  resolvedAt: integer('resolved_at'),
});

// ----------------------------------------------------------------------------
// kg_audit — every tool call (Phase 5 wires writes; Phase 2 creates table)
// ----------------------------------------------------------------------------

/**
 * Audit log of every MCP tool call. Phase 5 wires the dispatcher to write
 * one row per call as part of the privacy invariant verification surface
 * (CLAUDE.md §Security #7). Phase 2 creates the table.
 *
 * NB: per CLAUDE.md §Security #7, the JSONL mirror path differs by scope —
 * project rows mirror to `.pharos/kg-audit.jsonl` (in the repo, safe for
 * `git add .`), personal/both rows mirror to `~/.pharos/profile/kg-audit.jsonl`.
 * Personal-scope audit rows go to a separate kg_audit table in the personal
 * DB, never the project DB. This split is enforced at the app layer.
 */
export const kgAudit = sqliteTable('kg_audit', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  ts: integer('ts').notNull(),
  toolName: text('tool_name').notNull(),
  scopeRequested: text('scope_requested').notNull(),
  callerCtx: text('caller_ctx'),
  responseTokens: integer('response_tokens'),
  error: text('error'),
});

// ----------------------------------------------------------------------------
// Type exports — used by repository.ts and the ingester
// ----------------------------------------------------------------------------

export type KgNode = typeof kgNodes.$inferSelect;
export type NewKgNode = typeof kgNodes.$inferInsert;
export type KgChunk = typeof kgChunks.$inferSelect;
export type NewKgChunk = typeof kgChunks.$inferInsert;
export type KgEdge = typeof kgEdges.$inferSelect;
export type NewKgEdge = typeof kgEdges.$inferInsert;
export type KgLogRow = typeof kgLog.$inferSelect;
export type NewKgLogRow = typeof kgLog.$inferInsert;

/**
 * The list of all schema-managed tables, useful for the schema test that
 * verifies the migration creates every expected table.
 */
export const KG_TABLES = [
  'kg_meta',
  'kg_nodes',
  'kg_edges',
  'kg_chunks',
  'kg_log',
  'kg_gaps',
  'kg_audit',
] as const;

/**
 * The two virtual tables created via raw SQL in the migration (drizzle-kit
 * doesn't emit virtual table DDL). Schema test verifies they exist.
 */
export const KG_VIRTUAL_TABLES = ['kg_chunks_fts', 'kg_chunks_vec'] as const;
