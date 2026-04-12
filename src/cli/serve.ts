#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, renameSync, readdirSync, cpSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { closeDb, openDb, type DbBundle } from '../db/client.js';
import { Repository } from '../db/repository.js';
import { ChokidarWatcher } from '../ingest/chokidar.js';
import { RepoMirrorWatcher } from '../ingest/repo-mirror.js';
import { scanRepoMarkdownFiles } from '../init/scanner.js';
import { copyMarkdownToWiki } from '../init/copy.js';
import { IngesterService } from '../ingest/ingester.js';
import { checkConsistency, listMarkdownFiles } from '../ingest/manifest.js';
import { executeToolConfig, makeExecuteHandler } from '../mcp/tools/execute.js';
import { searchToolConfig, makeSearchHandler } from '../mcp/tools/search.js';
import {
  resolveAbs,
  projectWikiPath as defaultProjectWikiPath,
  projectDbPath as defaultProjectDbPath,
  projectAuditJsonlPath,
  personalWikiPath as defaultPersonalWikiPath,
  personalDbPath as defaultPersonalDbPath,
  personalAuditJsonlPath,
  projectDataDir,
  pinakesRoot,
  legacyProjectWikiPath,
  ensurePinakesGitignore,
} from '../paths.js';
import { writeAuditRow, type AuditEntry } from '../observability/audit.js';
import { child, logger } from '../observability/logger.js';
import { installSighupHandler, metrics } from '../observability/metrics.js';
import { createEmbedder, type Embedder } from '../retrieval/embedder.js';
import { QuickJSExecutor } from '../sandbox/executor.js';
import type { IngestEvent } from '../ingest/source.js';

/**
 * `pinakes serve` — stdio MCP server for Pinakes Phase 2.
 *
 * Replaces Phase 1's `src/spike.ts` with the production wiring:
 *   1. Open project + (optional) personal SQLite DBs (one writer + 2 readers each)
 *   2. Warm the embedder singleton
 *   3. Run startup consistency check against the manifest → re-ingest stale files
 *   4. Start chokidar watchers for both scopes (with 2s debounce, drop-oldest)
 *   5. Build the McpServer + register `search` and `execute`
 *   6. Connect to StdioServerTransport and listen
 *
 * Graceful shutdown on SIGTERM/SIGINT closes the watchers, drains in-flight
 * ingests, closes the DBs, and exits within 2 seconds.
 *
 * Per CLAUDE.md §Security #1: only the project repository binding is exposed
 * to the tool handlers in Phase 2. Personal-scope tool reads stay gated
 * behind the existing Phase 5 check in the tool handlers — even though the
 * personal-scope DB is fully populated by the watcher, the LLM can't read
 * from it until the 15-test privacy adversarial suite lands in Phase 5.
 */

export interface ServeOptions {
  /** Project root directory (default: cwd). Wiki lives at `<projectRoot>/.pinakes/wiki/`. */
  projectRoot?: string;
  /** Project DB path (default: `~/.pinakes/projects/<mangled-root>/pinakes.db`) */
  dbPath?: string;
  /** Personal wiki directory (default: `~/.pinakes/wiki`) */
  profilePath?: string;
  /** Personal DB path (default: `~/.pinakes/pinakes.db`) */
  profileDbPath?: string;
}

interface ServerHandle {
  server: McpServer;
  shutdown: (signal: string) => Promise<void>;
}

/**
 * Build (but don't start) the stdio server. Exposed as a function so future
 * tests / in-process integrations can construct a server without going
 * through the CLI argv path.
 */
export async function buildServer(options: ServeOptions): Promise<ServerHandle> {
  const projectRoot = resolveAbs(options.projectRoot ?? process.cwd());

  // Ensure .pinakes/.gitignore exists before any wiki operations
  ensurePinakesGitignore(projectRoot);

  // Migrate wiki from old centralized location to in-repo path
  migrateLegacyWikiToInRepo(projectRoot);

  const projectWiki = defaultProjectWikiPath(projectRoot);
  if (!existsSync(projectWiki)) {
    // First run — seed wiki from all repo markdown files
    const repoFiles = scanRepoMarkdownFiles(projectRoot);
    mkdirSync(projectWiki, { recursive: true });
    if (repoFiles.length > 0) {
      const copyResult = copyMarkdownToWiki(repoFiles, projectRoot, projectWiki);
      logger.info(
        { copied: copyResult.files_copied, skipped: copyResult.files_skipped, bytes: copyResult.total_bytes },
        'seeded wiki from repo markdown files'
      );
    } else {
      logger.info({ path: projectWiki }, 'created empty wiki directory (no .md files found in repo)');
    }
  }
  const projectDb = resolveAbs(options.dbPath ?? defaultProjectDbPath(projectRoot));
  migrateLegacyInProject(projectRoot, projectDb);

  const profileWiki = resolveAbs(options.profilePath ?? defaultPersonalWikiPath());
  if (!existsSync(profileWiki)) {
    mkdirSync(profileWiki, { recursive: true });
    logger.info({ path: profileWiki }, 'created personal wiki directory');
  }
  const profileDbPath = resolveAbs(options.profileDbPath ?? defaultPersonalDbPath());
  const enablePersonal = true;

  // Step 1: open DBs
  const projectBundle = openDb(projectDb);
  const personalBundle: DbBundle | null = enablePersonal ? openDb(profileDbPath) : null;

  // Step 2: warm embedder
  const embedder: Embedder = createEmbedder();
  await embedder.warmup();

  // Step 3: ingesters per scope
  const projectIngester = new IngesterService(projectBundle, embedder, 'project', projectWiki, {
    manifestPath: resolve(projectDataDir(projectRoot), 'manifest.json'),
  });
  const personalIngester = personalBundle
    ? new IngesterService(personalBundle, embedder, 'personal', profileWiki, {
        manifestPath: resolve(pinakesRoot(), 'manifest.json'),
      })
    : null;

  // Step 4: startup consistency check — re-ingest any stale files.
  // Pass the DB writer so checkConsistency can cross-validate manifest claims
  // against actual DB rows. This catches the "manifest says indexed but DB is
  // empty" scenario (DB recreated, migration dropped tables, etc.).
  await runStartupConsistency(projectIngester, projectWiki, 'project', projectBundle.writer);
  if (personalIngester && personalBundle) {
    await runStartupConsistency(personalIngester, profileWiki, 'personal', personalBundle.writer);
  }

  // Step 5: start watchers
  const projectWatcher = new ChokidarWatcher({ rootDir: projectWiki, scope: 'project' });
  const personalWatcher = personalIngester
    ? new ChokidarWatcher({ rootDir: profileWiki, scope: 'personal' })
    : null;

  await projectWatcher.start(makeOnEvent(projectIngester));
  if (personalWatcher && personalIngester) {
    await personalWatcher.start(makeOnEvent(personalIngester));
  }

  // Step 5b: repo mirror watcher — one-way sync from project root → wiki
  const repoMirror = new RepoMirrorWatcher({
    projectRoot,
    wikiRoot: projectWiki,
  });
  await repoMirror.start();

  // Step 6: build the MCP server
  const repository = new Repository(projectBundle, personalBundle);
  const executor = new QuickJSExecutor();
  await executor.warmup();

  // Audit JSONL paths (CLAUDE.md §Security #7: scope-split)
  const projectAuditJsonl = projectAuditJsonlPath(projectRoot);
  const personalAuditJsonl = personalAuditJsonlPath();

  const auditCtx: InstrumentCtx = {
    projectBundle,
    personalBundle: personalBundle ?? undefined,
    projectAuditJsonl,
    personalAuditJsonl,
  };

  // Tool & server naming — configurable via env for eval variants,
  // defaults to the winning configuration from eval run (80% selection rate).
  const searchToolName = process.env.PINAKES_TOOL_SEARCH_NAME ?? 'knowledge_search';
  const executeToolName = process.env.PINAKES_TOOL_EXECUTE_NAME ?? 'knowledge_query';
  const serverName = process.env.PINAKES_SERVER_NAME ?? 'project-docs';

  const instructions =
    'IMPORTANT: This project has a curated knowledge base indexed by Pinakes. ' +
    `ALWAYS use \`${searchToolName}\` as your FIRST action when you need to understand anything about ` +
    'this project — architecture, conventions, decisions, requirements, data models, ' +
    'deployment, testing strategy, security, performance constraints, or how subsystems relate. ' +
    'The knowledge base contains distilled, high-quality documentation that is faster to query ' +
    'and more token-efficient than reading raw source files with Grep or Read. ' +
    'Only fall back to Grep/Read/Glob after checking the knowledge base, or when you need ' +
    'to find exact symbols, read specific source files, or make code changes. ' +
    `Use \`${executeToolName}\` for advanced operations: graph traversal, gap detection, writing new knowledge.`;

  const mcp = new McpServer(
    { name: serverName, version: '0.3.5' },
    { capabilities: { tools: {} }, instructions }
  );
  mcp.registerTool(searchToolName, searchToolConfig, instrumentHandler(
    searchToolName,
    makeSearchHandler({
      repository, embedder, bundle: projectBundle,
      personalBundle: personalBundle ?? undefined,
    }),
    auditCtx,
  ));
  mcp.registerTool(executeToolName, executeToolConfig, instrumentHandler(
    executeToolName,
    makeExecuteHandler({
      repository, executor, bundle: projectBundle, embedder,
      wikiRoot: projectWiki,
      personalBundle: personalBundle ?? undefined,
      personalWikiRoot: enablePersonal ? profileWiki : undefined,
    }),
    auditCtx,
  ));

  // Step 7: periodic background health check — detect index drift at runtime.
  // Compares disk file count vs DB indexed file count every HEALTH_CHECK_INTERVAL_MS.
  // If there's a mismatch, re-runs the full consistency check (with DB cross-validation)
  // and re-ingests stale files. This catches missed chokidar events, silent write
  // failures, or DB state changes that happen while the server is running.
  const HEALTH_CHECK_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
  let healthCheckRunning = false;

  const healthCheckTimer = setInterval(() => {
    if (healthCheckRunning) return; // don't overlap
    void runHealthCheck();
  }, HEALTH_CHECK_INTERVAL_MS);
  // Don't let the timer keep the process alive on shutdown.
  healthCheckTimer.unref();

  async function runHealthCheck(): Promise<void> {
    healthCheckRunning = true;
    try {
      const diskFiles = listMarkdownFiles(projectWiki);
      const dbCount = (projectBundle.writer
        .prepare('SELECT COUNT(DISTINCT source_uri) AS cnt FROM pinakes_nodes WHERE scope = ?')
        .get('project') as { cnt: number })?.cnt ?? 0;

      if (diskFiles.length !== dbCount) {
        logger.info(
          { diskFiles: diskFiles.length, dbIndexed: dbCount, scope: 'project' },
          'health check: index drift detected — running consistency check'
        );
        await runStartupConsistency(projectIngester, projectWiki, 'project', projectBundle.writer);
      }

      if (personalIngester && personalBundle) {
        const personalDiskFiles = listMarkdownFiles(profileWiki);
        const personalDbCount = (personalBundle.writer
          .prepare('SELECT COUNT(DISTINCT source_uri) AS cnt FROM pinakes_nodes WHERE scope = ?')
          .get('personal') as { cnt: number })?.cnt ?? 0;

        if (personalDiskFiles.length !== personalDbCount) {
          logger.info(
            { diskFiles: personalDiskFiles.length, dbIndexed: personalDbCount, scope: 'personal' },
            'health check: index drift detected — running consistency check'
          );
          await runStartupConsistency(personalIngester, profileWiki, 'personal', personalBundle.writer);
        }
      }
    } catch (err) {
      logger.warn({ err }, 'health check failed');
    } finally {
      healthCheckRunning = false;
    }
  }

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'pinakes shutting down');
    try {
      clearInterval(healthCheckTimer);
      await repoMirror.stop();
      await projectWatcher.stop();
      if (personalWatcher) await personalWatcher.stop();
      await mcp.close();
    } catch (err) {
      logger.warn({ err }, 'shutdown error');
    } finally {
      closeDb(projectBundle);
      if (personalBundle) closeDb(personalBundle);
    }
  };

  return { server: mcp, shutdown };
}

/**
 * The CLI entry point: build the server, connect stdio, install signal
 * handlers, listen forever.
 */
export async function serveCommand(options: ServeOptions): Promise<void> {
  logger.info({ projectRoot: options.projectRoot ?? process.cwd() }, 'pinakes starting');

  installSighupHandler();

  const { server, shutdown } = await buildServer(options);

  const transport = new StdioServerTransport();
  process.on('SIGTERM', () => {
    void shutdown('SIGTERM').then(() => process.exit(0));
  });
  process.on('SIGINT', () => {
    void shutdown('SIGINT').then(() => process.exit(0));
  });

  await server.connect(transport);
  logger.info('pinakes listening on stdio');
}

// ----------------------------------------------------------------------------
// Internals
// ----------------------------------------------------------------------------

function makeOnEvent(ingester: IngesterService) {
  return async (ev: IngestEvent): Promise<void> => {
    if (ev.kind === 'file:removed') {
      ingester.removeFile(ev.path);
      return;
    }
    await ingester.ingestFile(ev.path);
  };
}

async function runStartupConsistency(
  ingester: IngesterService,
  wikiDir: string,
  scope: 'project' | 'personal',
  writer?: import('better-sqlite3').Database
): Promise<void> {
  // Migrate legacy absolute file:// URIs to relative paths (0.1.9+).
  // Old project-scope rows have source_uri like "file:///abs/path/auth.md";
  // new rows use relative paths like "auth.md". Delete the orphans so they
  // don't pollute search results after re-ingest.
  if (scope === 'project' && writer) {
    try {
      const orphaned = writer
        .prepare("SELECT COUNT(*) AS cnt FROM pinakes_nodes WHERE scope = 'project' AND source_uri LIKE 'file://%'")
        .get() as { cnt: number };
      if (orphaned.cnt > 0) {
        logger.info({ count: orphaned.cnt }, 'migrating legacy absolute-path rows — deleting orphans before re-ingest');
        writer.exec("DELETE FROM pinakes_chunks_vec WHERE rowid IN (SELECT c.rowid FROM pinakes_chunks c JOIN pinakes_nodes n ON c.node_id = n.id WHERE n.scope = 'project' AND n.source_uri LIKE 'file://%')");
        writer.exec("DELETE FROM pinakes_nodes WHERE scope = 'project' AND source_uri LIKE 'file://%'");
      }
    } catch (err) {
      logger.warn({ err }, 'legacy URI migration check failed — continuing');
    }
  }

  ingester.reloadManifest();
  const manifest = ingester.getManifest();
  const stale = checkConsistency(manifest, wikiDir, scope, writer);
  if (stale.length === 0) {
    logger.info({ scope, wikiDir }, 'startup consistency check: nothing stale');
    return;
  }
  logger.info({ scope, wikiDir, stale: stale.length }, 'startup consistency check: re-ingesting stale files');
  for (const file of stale) {
    try {
      await ingester.ingestFile(file);
    } catch (err) {
      logger.warn({ err, file, scope }, 'startup consistency: file ingest failed');
    }
  }
}

/**
 * Migrate wiki from the old centralized `~/.pinakes/projects/<mangled>/wiki/`
 * to the new in-repo `<projectRoot>/.pinakes/wiki/` path.
 *
 * Uses cpSync (not renameSync) because old and new paths may be on different
 * filesystems. Safe: if copy fails, old data remains untouched.
 */
function migrateLegacyWikiToInRepo(projectRoot: string): void {
  const oldWiki = legacyProjectWikiPath(projectRoot);
  const newWiki = defaultProjectWikiPath(projectRoot);

  if (existsSync(oldWiki) && !existsSync(newWiki)) {
    try {
      mkdirSync(dirname(newWiki), { recursive: true });
      cpSync(oldWiki, newWiki, { recursive: true });
      rmSync(oldWiki, { recursive: true, force: true });
      logger.info({ from: oldWiki, to: newWiki }, 'migrated wiki from centralized to in-repo path');
    } catch (err) {
      logger.warn({ err, from: oldWiki, to: newWiki }, 'wiki migration failed — continuing');
    }
  } else if (existsSync(oldWiki) && existsSync(newWiki)) {
    logger.warn(
      { old: oldWiki, new: newWiki },
      'wiki exists at both legacy and in-repo paths — using in-repo path. Remove legacy path manually if no longer needed.'
    );
  }
}

/**
 * Migrate legacy data from in-project `.pinakes/` (or `kg.db`) to the new
 * centralized `~/.pinakes/projects/<mangled>/` layout.
 *
 * Handles three legacy layouts:
 *   1. `<projectRoot>/kg.db` — Phase 1 flat layout
 *   2. `<projectRoot>/.pinakes/` — Phase 2 in-project layout (DB/manifest/audit only; wiki stays in-repo)
 *   3. Orphaned manifest files in project root
 */
function migrateLegacyInProject(projectRoot: string, newDbPath: string): void {
  const targetDir = projectDataDir(projectRoot);

  // 1. Legacy kg.db in project root
  const legacyDb = resolve(projectRoot, 'kg.db');
  if (existsSync(legacyDb) && !existsSync(newDbPath)) {
    mkdirSync(dirname(newDbPath), { recursive: true });
    renameSync(legacyDb, newDbPath);
    for (const suffix of ['-wal', '-shm']) {
      const old = legacyDb + suffix;
      if (existsSync(old)) renameSync(old, newDbPath + suffix);
    }
    logger.info({ from: legacyDb, to: newDbPath }, 'migrated legacy kg.db');
  }

  // 2. Legacy in-project .pinakes/ — only migrate non-wiki items (DB, manifest,
  //    audit) to centralized location. Wiki stays in-repo.
  const legacyPinakesDir = resolve(projectRoot, '.pinakes');
  if (existsSync(legacyPinakesDir) && legacyPinakesDir !== targetDir) {
    mkdirSync(targetDir, { recursive: true });
    try {
      const entries = readdirSync(legacyPinakesDir, { withFileTypes: true });
      for (const entry of entries) {
        // Skip wiki/ and .gitignore — they belong in-repo
        if (entry.name === 'wiki' || entry.name === '.gitignore') continue;
        const src = resolve(legacyPinakesDir, entry.name);
        const dst = resolve(targetDir, entry.name);
        if (!existsSync(dst)) {
          cpSync(src, dst, { recursive: true });
          logger.info({ from: src, to: dst }, 'migrated legacy .pinakes entry');
        }
        // Remove the migrated source entry (but keep .pinakes/ dir since wiki lives there now)
        rmSync(src, { recursive: true, force: true });
      }
    } catch (err) {
      logger.warn({ err, from: legacyPinakesDir, to: targetDir }, 'legacy .pinakes/ migration failed — continuing');
    }
  }

  // 3. Clean up orphaned files in project root from earlier versions
  for (const orphan of ['manifest.json', 'kg-manifest.json']) {
    const p = resolve(projectRoot, orphan);
    if (existsSync(p)) {
      // Move to target dir if not already there, otherwise just delete
      const dst = resolve(targetDir, 'manifest.json');
      if (!existsSync(dst)) {
        mkdirSync(targetDir, { recursive: true });
        renameSync(p, dst);
        logger.info({ from: p, to: dst }, 'migrated orphaned manifest');
      } else {
        rmSync(p);
        logger.info({ path: p }, 'removed orphaned manifest (already exists at target)');
      }
    }
  }
}

// ----------------------------------------------------------------------------
// Tool call instrumentation (correlation IDs + audit + metrics)
// ----------------------------------------------------------------------------

interface InstrumentCtx {
  projectBundle: DbBundle;
  personalBundle?: DbBundle;
  projectAuditJsonl: string;
  personalAuditJsonl: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ToolHandler = (args: any) => Promise<{
  content: [{ type: 'text'; text: string }];
  isError?: boolean;
}>;

/**
 * Wrap a tool handler with:
 *   1. Per-call correlation ID (callId) threaded into a pino child logger
 *   2. Structured entry/exit logging with latency
 *   3. Audit row written to the scope-appropriate DB + JSONL mirror
 *   4. Metrics counter update
 */
function instrumentHandler(
  toolName: string,
  handler: ToolHandler,
  ctx: InstrumentCtx
): ToolHandler {
  return async (args) => {
    const callId = randomUUID();
    const scope = (args.scope as string) ?? 'project';
    const log = child({ callId, tool: toolName, scope });

    log.info({ args: summarizeArgs(args) }, 'tool call start');
    const start = performance.now();

    let result: Awaited<ReturnType<ToolHandler>>;
    let error: string | undefined;
    try {
      result = await handler(args);
    } catch (err) {
      const latencyMs = Math.round(performance.now() - start);
      error = err instanceof Error ? err.message : String(err);
      log.error({ err, latencyMs }, 'tool call failed');
      metrics.recordToolCall(toolName, latencyMs, true);
      writeAudit(ctx, toolName, scope, callId, undefined, error);
      throw err;
    }

    const latencyMs = Math.round(performance.now() - start);

    // Extract tokens_used from the envelope embedded in the response text
    let responseTokens: number | undefined;
    try {
      const envelope = JSON.parse(result.content[0].text) as {
        meta?: { tokens_used?: number };
        result?: { error?: string };
      };
      responseTokens = envelope?.meta?.tokens_used;
      if (envelope?.result && typeof envelope.result === 'object' && 'error' in envelope.result) {
        error = String(envelope.result.error);
      }
    } catch {
      // Non-JSON response — shouldn't happen, but don't crash the wrapper
    }

    log.info({ latencyMs, responseTokens }, 'tool call end');
    metrics.recordToolCall(toolName, latencyMs, !!error);
    writeAudit(ctx, toolName, scope, callId, responseTokens, error);

    return result;
  };
}

/**
 * Write audit row to the correct DB + JSONL per scope-split rule.
 */
function writeAudit(
  ctx: InstrumentCtx,
  toolName: string,
  scope: string,
  callId: string,
  responseTokens: number | undefined,
  error: string | undefined
): void {
  const entry: AuditEntry = {
    toolName,
    scopeRequested: scope,
    callerCtx: callId,
    responseTokens,
    error,
  };

  if (scope === 'project') {
    writeAuditRow(ctx.projectBundle.writer, ctx.projectAuditJsonl, entry);
  } else if (ctx.personalBundle) {
    writeAuditRow(ctx.personalBundle.writer, ctx.personalAuditJsonl, entry);
  } else {
    // Fallback: write to project DB if personal is not configured
    writeAuditRow(ctx.projectBundle.writer, ctx.projectAuditJsonl, entry);
  }
}

/**
 * Summarize args for logging without dumping huge code strings.
 */
function summarizeArgs(args: Record<string, unknown>): Record<string, unknown> {
  const summary: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args)) {
    if (k === 'code' && typeof v === 'string') {
      summary[k] = v.length > 100 ? v.slice(0, 100) + '...' : v;
    } else {
      summary[k] = v;
    }
  }
  return summary;
}
