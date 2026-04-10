import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import type { Database as BetterSqliteDatabase } from 'better-sqlite3';

import type { DbBundle } from '../db/client.js';
import type { Embedder } from '../retrieval/embedder.js';
import { logger } from '../observability/logger.js';
import { countTokens } from '../gate/budget.js';
import {
  type Manifest,
  type ManifestEntry,
  emptyManifest,
  fileSha,
  manifestPathFor,
  readManifest,
  removeManifestEntry,
  updateManifestEntry,
  writeManifest,
} from './manifest.js';
import { parseMarkdown, detectConfidence, type SectionNode } from './parse/markdown.js';
import { detectGaps } from '../gaps/detector.js';
import { chunkSection, type Chunk as ChunkText } from './parse/chunk.js';

/**
 * IngesterService — the load-bearing single-flight writer for KG-MCP Phase 2.
 *
 * **What it does**: given an absolute path to a markdown file, parse it into
 * sections, chunk each section, embed only the chunks whose sha changed, and
 * upsert the result into SQLite under one transaction. Update the consistency
 * manifest, append a row to `kg_log`. Errors trigger a clean rollback and an
 * error log entry, but never throw past the caller's await — they're caught,
 * logged, and re-thrown so the rebuild CLI can decide whether to abort or
 * continue.
 *
 * **Key invariants** (from CLAUDE.md §Database Rules):
 *
 * - **Single writer per source_uri**: a module-level `Map<string, Promise>`
 *   gates concurrent calls to `ingestFile(samePath)`. The second caller waits
 *   on the first's promise, then exits early (no double-ingest). This is the
 *   single-flight pattern; CLAUDE.md §Architecture #3 / §Database Rules #5.
 *
 * - **Per-chunk skip-unchanged**: on a re-ingest of an existing file, we
 *   load the existing `kg_chunks` rows for that file's nodes, build a
 *   `Set<chunk_sha>` of already-embedded chunks, and only call `embedder.embed()`
 *   for chunks whose sha is NOT in the set. This is THE optimization that
 *   makes Pharos's whole-file-rewrite-per-turn pattern viable — without it,
 *   60 chunks × 50ms embed = 3s of blocking work per turn (Loop 6.5 A4).
 *
 * - **Transaction per file**: all DML for one file lives inside one
 *   `BEGIN ... COMMIT` block. Partial failures roll back cleanly so the DB
 *   never observes a half-ingested file. The FTS5 triggers fire inside the
 *   transaction; sqlite-vec inserts also happen inside.
 *
 * - **Idempotent upserts**: node ids and chunk ids are deterministic
 *   `sha1()` of stable inputs, so re-ingesting the same content produces
 *   identical row ids. We use `INSERT OR REPLACE` so a re-ingest with
 *   different content cleanly overwrites.
 *
 * - **Manifest is the tiebreaker on crash recovery**: written AFTER the
 *   transaction commits. If we crash between COMMIT and writeManifest, the
 *   next startup's consistency check will detect the divergence (DB has
 *   the new chunks but manifest still has old chunk_shas) and re-ingest.
 *   The work is duplicated but not wrong — that's the right safety/perf
 *   tradeoff for pre-v1 sqlite-vec.
 */

// ----------------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------------

export type Scope = 'project' | 'personal';

export interface IngestResult {
  /** Number of new chunks written (post-skip) */
  chunks_added: number;
  /** Number of chunks reused via per-chunk skip (no embedder call) */
  chunks_skipped: number;
  /** Number of embedder.embed() calls actually made */
  embedder_calls: number;
  /** Number of nodes (sections) written for this file */
  nodes_written: number;
  /** True if the file was unchanged and we exited early via the manifest fast path */
  noop: boolean;
}

export interface IngesterOptions {
  /** Optional override for the manifest file path (default: derived from wikiRoot) */
  manifestPath?: string;
}

// ----------------------------------------------------------------------------
// Single-flight gate (module-level)
// ----------------------------------------------------------------------------

/**
 * Module-level single-flight map. Keyed by `${scope}:${absPath}` so the same
 * file can be ingested concurrently for different scopes (e.g. if the wiki
 * dir lives at the same path for both scopes — unusual but possible).
 *
 * The promise stored here is the FULL `ingestFile` operation; concurrent
 * callers await the same promise and observe the same result. After the
 * promise settles, the entry is removed so subsequent calls run fresh.
 *
 * Test reset hook: `__resetSingleFlightForTests()` clears the map between
 * tests so a leftover entry from a prior test doesn't affect the next one.
 */
const inFlight: Map<string, Promise<IngestResult>> = new Map();

/** Test-only: clear the single-flight map. Do not call from production code. */
export function __resetSingleFlightForTests(): void {
  inFlight.clear();
}

// ----------------------------------------------------------------------------
// IngesterService
// ----------------------------------------------------------------------------

export class IngesterService {
  private manifest: Manifest;
  private readonly manifestPath: string;

  constructor(
    private readonly bundle: DbBundle,
    private readonly embedder: Embedder,
    private readonly scope: Scope,
    wikiRoot: string,
    options: IngesterOptions = {}
  ) {
    this.manifestPath = options.manifestPath ?? manifestPathFor(wikiRoot);
    this.manifest = readManifest(this.manifestPath);
  }

  /**
   * Ingest a single markdown file. Single-flight: concurrent calls for the
   * same file return the same in-progress promise.
   *
   * Returns the per-chunk metrics for this run (added/skipped/embedder calls)
   * so callers (rebuild CLI, chokidar handler) can log a summary.
   */
  async ingestFile(absPath: string): Promise<IngestResult> {
    const key = `${this.scope}:${resolve(absPath)}`;
    const existing = inFlight.get(key);
    if (existing) return existing;

    const promise = this.ingestFileImpl(resolve(absPath))
      .catch((err) => {
        // Make sure single-flight cleanup runs even on error.
        logger.error({ err, file: absPath, scope: this.scope }, 'ingest failed');
        this.appendLog('ingest:error', absPath, {
          error: err instanceof Error ? err.message : String(err),
        });
        throw err;
      })
      .finally(() => {
        inFlight.delete(key);
      });

    inFlight.set(key, promise);
    return promise;
  }

  /**
   * Remove a file from the index (for `file:removed` chokidar events).
   * Deletes the file's nodes (cascades to chunks/edges/vec rows via FK)
   * and updates the manifest. Single-statement, no transaction needed.
   */
  removeFile(absPath: string): void {
    const abs = resolve(absPath);
    const sourceUri = pathToFileURL(abs).href;

    this.bundle.writer
      .prepare('DELETE FROM kg_nodes WHERE scope = ? AND source_uri = ?')
      .run(this.scope, sourceUri);

    this.manifest = removeManifestEntry(this.manifest, abs);
    writeManifest(this.manifestPath, this.manifest);

    this.appendLog('ingest:removed', abs, {});
  }

  /**
   * The current in-memory manifest. Exposed for tests + the startup
   * consistency check in `cli/serve.ts`.
   */
  getManifest(): Manifest {
    return this.manifest;
  }

  /**
   * Reload the manifest from disk. Used at startup before walking the
   * consistency check, and by tests that mutate the manifest externally.
   */
  reloadManifest(): void {
    this.manifest = readManifest(this.manifestPath);
  }

  // --------------------------------------------------------------------------
  // Internal: the actual ingest pipeline
  // --------------------------------------------------------------------------

  private async ingestFileImpl(absPath: string): Promise<IngestResult> {
    // Step 1: read file + compute file-level sha
    const text = readFileSync(absPath, 'utf8');
    const sourceSha = sha1(text);
    const sourceUri = pathToFileURL(absPath).href;

    // Step 2: manifest fast path — same source_sha → no work
    const existingEntry = this.manifest.files[absPath];
    if (existingEntry && existingEntry.source_sha === sourceSha) {
      return {
        chunks_added: 0,
        chunks_skipped: 0,
        embedder_calls: 0,
        nodes_written: 0,
        noop: true,
      };
    }

    // Step 3: parse + chunk + detect confidence
    const sections = parseMarkdown(text);
    const confidence = detectConfidence(text);
    const planned: PlannedNode[] = sections.map((section) => {
      const nodeId = nodeIdFor(this.scope, sourceUri, section.section_path);
      const chunks = chunkSection(section.content);
      return {
        nodeId,
        section,
        chunks: chunks.map((chunkText, idx) => ({
          id: chunkIdFor(nodeId, idx),
          text: chunkText.text,
          chunkSha: sha1(chunkText.text),
          tokenCount: chunkText.token_count,
          chunkIndex: idx,
        })),
      };
    });

    // Step 4: load existing chunk_shas → embedding map for skip-unchanged
    const existingEmbeddings = this.loadExistingEmbeddings(sourceUri);

    // Step 5: embed only new chunks
    let embedderCalls = 0;
    let chunksSkipped = 0;
    const embeddings = new Map<string, Float32Array>();

    for (const node of planned) {
      for (const chunk of node.chunks) {
        const cached = existingEmbeddings.get(chunk.chunkSha);
        if (cached) {
          embeddings.set(chunk.id, cached);
          chunksSkipped++;
        } else {
          try {
            const vec = await this.embedder.embed(chunk.text);
            embeddings.set(chunk.id, vec);
            embedderCalls++;
          } catch (err) {
            // Per CLAUDE.md §AI Rules #4: embedder failure is non-fatal.
            // Insert the chunk without a vec row; FTS5 still works.
            logger.warn(
              { err, chunkId: chunk.id, file: absPath },
              'embedder failed for chunk; inserting without vec row'
            );
          }
        }
      }
    }

    // Step 6: transaction — delete-then-insert nodes/chunks/vec for this file
    const now = Date.now();
    const totalChunks = planned.reduce((acc, n) => acc + n.chunks.length, 0);

    this.runInTransaction((w) => {
      // Delete old vec rows BEFORE deleting kg_chunks rows. We need to know
      // the rowids first because the FK cascade will drop the kg_chunks rows
      // (and sqlite-vec doesn't have FK awareness).
      const oldRowids = w
        .prepare<[string, string], { rowid: number }>(
          `SELECT c.rowid AS rowid
             FROM kg_chunks c JOIN kg_nodes n ON c.node_id = n.id
            WHERE n.scope = ? AND n.source_uri = ?`
        )
        .all(this.scope, sourceUri);

      if (oldRowids.length > 0) {
        const placeholders = oldRowids.map(() => '?').join(',');
        w.prepare(`DELETE FROM kg_chunks_vec WHERE rowid IN (${placeholders})`).run(
          ...oldRowids.map((r) => r.rowid)
        );
      }

      // Delete old nodes for this file (cascades to chunks → FTS5 trigger fires).
      w.prepare('DELETE FROM kg_nodes WHERE scope = ? AND source_uri = ?').run(
        this.scope,
        sourceUri
      );

      // Insert new nodes
      const insertNode = w.prepare(
        `INSERT INTO kg_nodes (id, scope, source_uri, section_path, kind, title, content, source_sha, token_count, created_at, updated_at, last_accessed_at, confidence)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      const insertChunk = w.prepare(
        `INSERT INTO kg_chunks (id, node_id, chunk_index, text, chunk_sha, token_count, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      );
      const insertVec = w.prepare(
        'INSERT INTO kg_chunks_vec(rowid, embedding) VALUES (?, ?)'
      );

      for (const node of planned) {
        const sectionTokenCount = countTokens(node.section.content);
        insertNode.run(
          node.nodeId,
          this.scope,
          sourceUri,
          node.section.section_path,
          node.section.kind,
          node.section.title || null,
          node.section.content,
          sourceSha,
          sectionTokenCount,
          now,
          now,
          now,
          confidence
        );

        for (const chunk of node.chunks) {
          // Capture lastInsertRowid directly from the chunk insert. This avoids
          // a follow-up SELECT.
          const info = insertChunk.run(
            chunk.id,
            node.nodeId,
            chunk.chunkIndex,
            chunk.text,
            chunk.chunkSha,
            chunk.tokenCount,
            now
          );
          // sqlite-vec's vec0 virtual table is strict: it rejects JS Number
          // bindings for the rowid column with "Only integers are allowed for
          // primary key values" — even though the value IS an integer at the
          // SQL level. We MUST bind as BigInt. (Verified via repro 2026-04-09.)
          // lastInsertRowid is `number | bigint`; coerce to BigInt either way.
          const rowidBig: bigint =
            typeof info.lastInsertRowid === 'bigint'
              ? info.lastInsertRowid
              : BigInt(info.lastInsertRowid);

          const vec = embeddings.get(chunk.id);
          if (vec) {
            insertVec.run(rowidBig, Buffer.from(vec.buffer));
          }
        }
      }
    });

    // Step 7: append kg_log row
    this.appendLog('ingest:done', absPath, {
      nodes: planned.length,
      chunks_added: totalChunks - chunksSkipped,
      chunks_skipped: chunksSkipped,
      embedder_calls: embedderCalls,
    });

    // Step 7.5: gap detection (Phase 6) — runs after commit, scans for concept
    // mentions and resolves gaps when matching nodes appear
    try {
      const nodeTitles = planned
        .map((n) => n.section.title)
        .filter((t): t is string => !!t);
      detectGaps(this.bundle.writer, this.scope, text, nodeTitles);
    } catch (err) {
      // Non-fatal: gap detection failure should never block ingest
      logger.warn({ err, file: absPath }, 'gap detection failed');
    }

    // Step 8: update manifest (AFTER commit)
    const allChunkShas = planned.flatMap((n) => n.chunks.map((c) => c.chunkSha));
    const newEntry: ManifestEntry = { source_sha: sourceSha, chunk_shas: allChunkShas };
    this.manifest = updateManifestEntry(this.manifest, absPath, newEntry);
    writeManifest(this.manifestPath, this.manifest);

    return {
      chunks_added: totalChunks - chunksSkipped,
      chunks_skipped: chunksSkipped,
      embedder_calls: embedderCalls,
      nodes_written: planned.length,
      noop: false,
    };
  }

  /**
   * Load `chunk_sha → embedding` for every existing chunk of a file. Used by
   * the per-chunk skip optimization: if a new chunk's sha matches one in
   * this map, we reuse the embedding instead of calling the embedder.
   *
   * Returns an empty map if the file isn't in the DB yet (first ingest).
   */
  private loadExistingEmbeddings(sourceUri: string): Map<string, Float32Array> {
    const out = new Map<string, Float32Array>();
    const rows = this.bundle.writer
      .prepare<
        [string, string],
        { chunk_sha: string; embedding: Buffer | null }
      >(
        `SELECT c.chunk_sha AS chunk_sha, vec.embedding AS embedding
           FROM kg_chunks c
           JOIN kg_nodes n ON c.node_id = n.id
           LEFT JOIN kg_chunks_vec vec ON vec.rowid = c.rowid
          WHERE n.scope = ? AND n.source_uri = ?`
      )
      .all(this.scope, sourceUri);

    for (const row of rows) {
      if (!row.embedding) continue;
      // sqlite-vec stores Float32 as a raw bytes blob. Reinterpret the buffer
      // (no copy needed since we won't mutate it).
      const buf = row.embedding;
      const view = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
      // Make a stable copy in case better-sqlite3 reuses the buffer.
      out.set(row.chunk_sha, new Float32Array(view));
    }

    return out;
  }

  private runInTransaction(fn: (writer: BetterSqliteDatabase) => void): void {
    const txn = this.bundle.writer.transaction(fn);
    txn(this.bundle.writer);
  }

  private appendLog(kind: string, absPath: string, payload: Record<string, unknown>): void {
    try {
      this.bundle.writer
        .prepare(
          `INSERT INTO kg_log (ts, scope, kind, source_uri, payload)
           VALUES (?, ?, ?, ?, ?)`
        )
        .run(Date.now(), this.scope, kind, pathToFileURL(absPath).href, JSON.stringify(payload));
    } catch (err) {
      logger.warn({ err, kind, absPath }, 'failed to append kg_log row');
    }
  }
}

// ----------------------------------------------------------------------------
// Helpers — id derivation
// ----------------------------------------------------------------------------

interface PlannedNode {
  nodeId: string;
  section: SectionNode;
  chunks: PlannedChunk[];
}

interface PlannedChunk {
  id: string;
  text: string;
  chunkSha: string;
  tokenCount: number;
  chunkIndex: number;
}

/** sha1(scope + ':' + source_uri + ':' + section_path) — locked id derivation */
function nodeIdFor(scope: Scope, sourceUri: string, sectionPath: string): string {
  return sha1(`${scope}:${sourceUri}:${sectionPath}`);
}

/** sha1(node_id + ':' + chunk_index) — locked id derivation */
function chunkIdFor(nodeId: string, chunkIndex: number): string {
  return sha1(`${nodeId}:${chunkIndex}`);
}

function sha1(input: string): string {
  return createHash('sha1').update(input).digest('hex');
}

// ----------------------------------------------------------------------------
// Cold-start helper for the rebuild CLI
// ----------------------------------------------------------------------------

/**
 * Reset the in-memory manifest to empty. Used by `kg rebuild` when the
 * caller passes `--clean` to force a full re-ingest from scratch.
 */
export function freshManifest(): Manifest {
  return emptyManifest();
}

// re-export internal types for tests
export type { ChunkText };
export { manifestPathFor };
export { fileSha };
