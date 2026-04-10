#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, renameSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, resolve } from 'node:path';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { closeDb, openDb, type DbBundle } from '../db/client.js';
import { Repository } from '../db/repository.js';
import { ChokidarWatcher } from '../ingest/chokidar.js';
import { IngesterService } from '../ingest/ingester.js';
import { checkConsistency, listMarkdownFiles } from '../ingest/manifest.js';
import { kgExecuteToolConfig, makeKgExecuteHandler } from '../mcp/tools/execute.js';
import { kgSearchToolConfig, makeKgSearchHandler } from '../mcp/tools/search.js';
import { writeAuditRow, type AuditEntry } from '../observability/audit.js';
import { child, logger } from '../observability/logger.js';
import { installSighupHandler, metrics } from '../observability/metrics.js';
import { createEmbedder, type Embedder } from '../retrieval/embedder.js';
import { QuickJSExecutor } from '../sandbox/executor.js';
import type { IngestEvent } from '../ingest/source.js';

/**
 * `kg serve` — stdio MCP server for KG-MCP Phase 2.
 *
 * Replaces Phase 1's `src/spike.ts` with the production wiring:
 *   1. Open project + (optional) personal SQLite DBs (one writer + 2 readers each)
 *   2. Warm the embedder singleton
 *   3. Run startup consistency check against the manifest → re-ingest stale files
 *   4. Start chokidar watchers for both scopes (with 2s debounce, drop-oldest)
 *   5. Build the McpServer + register `kg_search` and `kg_execute`
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
  /** Project wiki directory (required) */
  wikiPath: string;
  /** Project DB path (default: `<wikiPath>/../.pinakes/pinakes.db`) */
  dbPath?: string;
  /** Personal wiki directory (default: `~/.pharos/profile/wiki` if it exists, else skip personal) */
  profilePath?: string;
  /** Personal DB path (default: `<profilePath>/../.kg/kg.db`) */
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
  const projectWiki = resolveAbs(options.wikiPath);
  if (!existsSync(projectWiki)) {
    mkdirSync(projectWiki, { recursive: true });
    logger.info({ path: projectWiki }, 'created wiki directory');
  }
  const projectDbPath = resolveAbs(options.dbPath ?? defaultDbPathFor(projectWiki));
  migrateLegacyDb(projectWiki, projectDbPath);

  const profileWiki = resolveAbs(options.profilePath ?? defaultProfileWikiPath());
  const profileDbPath = resolveAbs(
    options.profileDbPath ?? defaultDbPathFor(profileWiki)
  );
  const enablePersonal = existsSync(profileWiki);

  // Step 1: open DBs
  const projectBundle = openDb(projectDbPath);
  const personalBundle: DbBundle | null = enablePersonal ? openDb(profileDbPath) : null;

  // Step 2: warm embedder
  const embedder: Embedder = createEmbedder();
  await embedder.warmup();

  // Step 3: ingesters per scope
  const projectIngester = new IngesterService(projectBundle, embedder, 'project', projectWiki);
  const personalIngester = personalBundle
    ? new IngesterService(personalBundle, embedder, 'personal', profileWiki)
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

  // Step 6: build the MCP server
  const repository = new Repository(projectBundle, personalBundle);
  const executor = new QuickJSExecutor();
  await executor.warmup();

  // Audit JSONL paths (CLAUDE.md §Security #7: scope-split)
  const projectAuditJsonl = resolve(dirname(projectDbPath), 'audit.jsonl');
  const personalAuditJsonl = resolve(homedir(), '.kg/audit.jsonl');

  const auditCtx: InstrumentCtx = {
    projectBundle,
    personalBundle: personalBundle ?? undefined,
    projectAuditJsonl,
    personalAuditJsonl,
  };

  const mcp = new McpServer(
    { name: 'kg-mcp', version: '0.7.0' },
    { capabilities: { tools: {} } }
  );
  mcp.registerTool('kg_search', kgSearchToolConfig, instrumentHandler(
    'kg_search',
    makeKgSearchHandler({
      repository, embedder, bundle: projectBundle,
      personalBundle: personalBundle ?? undefined,
    }),
    auditCtx,
  ));
  mcp.registerTool('kg_execute', kgExecuteToolConfig, instrumentHandler(
    'kg_execute',
    makeKgExecuteHandler({
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
        .prepare('SELECT COUNT(DISTINCT source_uri) AS cnt FROM kg_nodes WHERE scope = ?')
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
          .prepare('SELECT COUNT(DISTINCT source_uri) AS cnt FROM kg_nodes WHERE scope = ?')
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
    logger.info({ signal }, 'kg-mcp shutting down');
    try {
      clearInterval(healthCheckTimer);
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
  logger.info({ wikiPath: options.wikiPath }, 'kg-mcp starting');

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
  logger.info('kg-mcp listening on stdio');
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
  ingester.reloadManifest();
  const manifest = ingester.getManifest();
  const stale = checkConsistency(manifest, wikiDir, writer);
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

function resolveAbs(p: string): string {
  return isAbsolute(p) ? p : resolve(process.cwd(), p);
}

function defaultDbPathFor(wikiDir: string): string {
  return resolve(dirname(wikiDir), '.pinakes', 'pinakes.db');
}

/**
 * Migrate legacy kg.db (and WAL/shm) from project root into .pinakes/.
 */
function migrateLegacyDb(wikiPath: string, newDbPath: string): void {
  const parent = dirname(resolve(wikiPath));
  const legacyDb = resolve(parent, 'kg.db');
  if (existsSync(legacyDb) && !existsSync(newDbPath)) {
    mkdirSync(dirname(newDbPath), { recursive: true });
    renameSync(legacyDb, newDbPath);
    // Move WAL and SHM files if they exist
    for (const suffix of ['-wal', '-shm']) {
      const old = legacyDb + suffix;
      if (existsSync(old)) renameSync(old, newDbPath + suffix);
    }
    logger.info({ from: legacyDb, to: newDbPath }, 'migrated legacy kg.db');
  }
}

function defaultProfileWikiPath(): string {
  const env = process.env.KG_PROFILE_PATH;
  if (env) return resolve(env, 'wiki');
  return resolve(homedir(), '.pharos/profile/wiki');
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
