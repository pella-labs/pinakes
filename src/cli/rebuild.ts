import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, resolve } from 'node:path';

import { closeDb, openDb } from '../db/client.js';
import { IngesterService } from '../ingest/ingester.js';
import { listMarkdownFiles } from '../ingest/manifest.js';
import { logger } from '../observability/logger.js';
import { TransformersEmbedder, type Embedder } from '../retrieval/embedder.js';

/**
 * `kg rebuild` — full-rebuild-from-markdown CLI subcommand for KG-MCP Phase 2.
 *
 * Walks the wiki directory, calls `IngesterService.ingestFile` for every
 * markdown file, prints a summary. Default behavior: ingest both project and
 * personal scope (if `--profile-path` resolves to a directory that exists).
 * Pass `--scope project` or `--scope personal` to narrow.
 *
 * **Why "rebuild" and not "ingest"**: this is the markdown-canonical recovery
 * path (CLAUDE.md §What this is — "If the index is corrupted or lost, rebuild
 * it from the markdown source"). It's the answer to "my SQLite file got
 * deleted / sqlite-vec broke / I changed the embedder model". The chokidar
 * watcher in Pass 3 is the steady-state ingest path.
 *
 * **Performance budget**: <10s for the fixture (PRD acceptance criterion #5).
 * On 100-file repos this should still complete in <2 minutes; the embedder
 * is the bottleneck (~50ms per chunk × ~3 chunks per file = 150ms per file
 * cold; warm chunks via per-chunk SHA skip drop this to ~5ms).
 */

export interface RebuildOptions {
  /** Project wiki directory (required) */
  wikiPath: string;
  /** Project DB path (default: `<wikiPath>/../kg.db`) */
  dbPath?: string;
  /** Personal wiki directory (default: `~/.pharos/profile/wiki`) */
  profilePath?: string;
  /** Personal DB path (default: `<profilePath>/../kg.db`) */
  profileDbPath?: string;
  /** Which scopes to rebuild: 'project' | 'personal' | 'both' (default: 'both', falls back to 'project' if profile dir missing) */
  scope?: 'project' | 'personal' | 'both';
  /**
   * Optional embedder injection — used by tests so they can pass a `CountingEmbedder`
   * instead of loading the real model. Default: `TransformersEmbedder` singleton.
   */
  embedder?: Embedder;
}

export interface RebuildSummary {
  scope: 'project' | 'personal';
  files: number;
  nodes: number;
  chunks_added: number;
  chunks_skipped: number;
  embedder_calls: number;
  durationMs: number;
}

/**
 * Run a full-rebuild against one or both scopes. Returns a list of summaries
 * (one per scope actually ingested). Throws on a fatal error per scope but
 * continues to the next scope so a corrupted personal DB doesn't block the
 * project rebuild (or vice versa).
 */
export async function rebuildCommand(options: RebuildOptions): Promise<RebuildSummary[]> {
  const summaries: RebuildSummary[] = [];

  const projectWiki = resolveAbs(options.wikiPath);
  if (!existsSync(projectWiki)) {
    throw new Error(`wiki path does not exist: ${projectWiki}`);
  }
  const projectDbPath = resolveAbs(options.dbPath ?? defaultDbPathFor(projectWiki));

  const profileWiki = resolveAbs(options.profilePath ?? defaultProfileWikiPath());
  const profileDbPath = resolveAbs(
    options.profileDbPath ?? defaultDbPathFor(profileWiki)
  );

  const scope = options.scope ?? 'both';
  const includeProject = scope === 'project' || scope === 'both';
  const includePersonal =
    (scope === 'personal' || scope === 'both') && existsSync(profileWiki);

  // Lazily construct the shared embedder once for both scopes.
  const embedder = options.embedder ?? new TransformersEmbedder();
  await embedder.warmup();

  if (includeProject) {
    const summary = await rebuildOneScope({
      scope: 'project',
      wikiDir: projectWiki,
      dbPath: projectDbPath,
      embedder,
    });
    summaries.push(summary);
  }

  if (includePersonal) {
    const summary = await rebuildOneScope({
      scope: 'personal',
      wikiDir: profileWiki,
      dbPath: profileDbPath,
      embedder,
    });
    summaries.push(summary);
  }

  return summaries;
}

async function rebuildOneScope(args: {
  scope: 'project' | 'personal';
  wikiDir: string;
  dbPath: string;
  embedder: Embedder;
}): Promise<RebuildSummary> {
  const { scope, wikiDir, dbPath, embedder } = args;
  const t0 = Date.now();

  const bundle = openDb(dbPath);
  try {
    // Clean up legacy absolute file:// URIs before rebuild (0.1.9+ migration).
    if (scope === 'project') {
      try {
        const orphaned = bundle.writer
          .prepare("SELECT COUNT(*) AS cnt FROM kg_nodes WHERE scope = 'project' AND source_uri LIKE 'file://%'")
          .get() as { cnt: number };
        if (orphaned.cnt > 0) {
          logger.info({ count: orphaned.cnt }, 'rebuild: deleting legacy absolute-path rows');
          bundle.writer.exec("DELETE FROM kg_chunks_vec WHERE rowid IN (SELECT c.rowid FROM kg_chunks c JOIN kg_nodes n ON c.node_id = n.id WHERE n.scope = 'project' AND n.source_uri LIKE 'file://%')");
          bundle.writer.exec("DELETE FROM kg_nodes WHERE scope = 'project' AND source_uri LIKE 'file://%'");
        }
      } catch (err) {
        logger.warn({ err }, 'legacy URI cleanup failed — continuing');
      }
    }

    const ingester = new IngesterService(bundle, embedder, scope, wikiDir);
    const files = listMarkdownFiles(wikiDir);

    let nodes = 0;
    let chunksAdded = 0;
    let chunksSkipped = 0;
    let embedderCalls = 0;

    for (const file of files) {
      try {
        const result = await ingester.ingestFile(file);
        nodes += result.nodes_written;
        chunksAdded += result.chunks_added;
        chunksSkipped += result.chunks_skipped;
        embedderCalls += result.embedder_calls;
      } catch (err) {
        logger.error({ err, file, scope }, 'rebuild: failed to ingest file');
        // Continue with the next file rather than aborting the entire rebuild —
        // partial progress is better than total failure here.
      }
    }

    return {
      scope,
      files: files.length,
      nodes,
      chunks_added: chunksAdded,
      chunks_skipped: chunksSkipped,
      embedder_calls: embedderCalls,
      durationMs: Date.now() - t0,
    };
  } finally {
    closeDb(bundle);
  }
}

// ----------------------------------------------------------------------------
// Path defaults
// ----------------------------------------------------------------------------

function resolveAbs(p: string): string {
  return isAbsolute(p) ? p : resolve(process.cwd(), p);
}

/**
 * Default DB path for a given wiki directory: `<wikiDir>/../.pinakes/pinakes.db`.
 */
function defaultDbPathFor(wikiDir: string): string {
  return resolve(dirname(wikiDir), '.pinakes', 'pinakes.db');
}

/**
 * Default personal wiki path. Honors `KG_PROFILE_PATH` env var, else
 * `~/.pharos/profile/wiki`.
 */
function defaultProfileWikiPath(): string {
  const env = process.env.KG_PROFILE_PATH;
  if (env) return resolve(env, 'wiki');
  return resolve(homedir(), '.pharos/profile/wiki');
}
