import { Scope, type QuickJSContext, type QuickJSHandle } from 'quickjs-emscripten';
import type { Database as BetterSqliteDatabase } from 'better-sqlite3';

import type { Repository } from '../../db/repository.js';
import { type DbBundle, nextReader } from '../../db/client.js';
import type { Embedder } from '../../retrieval/embedder.js';
import { ftsQuery as ftsQueryImpl } from '../../retrieval/fts.js';
import { vecQuery as vecQueryImpl } from '../../retrieval/vec.js';
import { rrfFuse } from '../../retrieval/hybrid.js';
import { pagerank, connectedComponents } from '../../retrieval/graph.js';
import { writeWikiFile, appendWikiLog, removeWikiFile, type WriteCounter } from './write.js';
import { queryGaps } from '../../gaps/detector.js';
import { errorMessage, marshalJsValue } from '../helpers.js';

/**
 * Dependencies for installing one scope's bindings in the sandbox.
 */
export interface KgBindingDeps {
  repository: Repository;
  bundle: DbBundle;
  scope: 'project' | 'personal';
  embedder: Embedder;
  wikiRoot?: string;
  writeCounter?: WriteCounter;
  queryEmbeddings?: Map<string, Float32Array>;
}

/**
 * Install the `kg` global with `kg.project.*` and/or `kg.personal.*`
 * bindings plus backward-compat `kg.search()` / `kg.get()` aliases
 * and `kg.describe()`.
 *
 * **Privacy invariant**: if `personalDeps` is undefined, `kg.personal`
 * does NOT exist in the sandbox — not undefined, not null, simply absent.
 * This is enforced at the dispatcher level (tool handler decides which
 * deps to pass). The 15-test adversarial suite verifies this.
 */
export function installKgBindings(
  context: QuickJSContext,
  projectDeps?: KgBindingDeps,
  personalDeps?: KgBindingDeps
): void {
  Scope.withScope((s) => {
    const kgObj = s.manage(context.newObject());

    // Install project namespace if deps provided
    if (projectDeps) {
      const projectObj = s.manage(context.newObject());
      installScopeBindings(context, s, projectObj, projectDeps);
      context.setProp(kgObj, 'project', projectObj);

      // Backward-compat aliases route to project scope
      installBackwardCompat(context, kgObj, projectDeps);
    }

    // Install personal namespace if deps provided (privacy invariant)
    if (personalDeps) {
      const personalObj = s.manage(context.newObject());
      installScopeBindings(context, s, personalObj, personalDeps);
      context.setProp(kgObj, 'personal', personalObj);
    }

    // kg.describe() — returns metadata for available scopes only
    attachFn(context, kgObj, 'describe', () => {
      const result: Record<string, unknown> = {};
      if (projectDeps) {
        result.project = describeScope(projectDeps);
      }
      if (personalDeps) {
        result.personal = describeScope(personalDeps);
      }
      return result;
    });

    context.setProp(context.global, 'kg', kgObj);
  });
}

/**
 * Install all bindings for one scope onto a QuickJS object.
 * Called once for project, once for personal (if both are requested).
 */
function installScopeBindings(
  context: QuickJSContext,
  s: InstanceType<typeof Scope>,
  scopeObj: QuickJSHandle,
  deps: KgBindingDeps
): void {
  const { bundle, scope } = deps;
  const reader = nextReader(bundle);
  const logObj = s.manage(context.newObject());

  // -- fts(query, opts?) -------------------------------------------------
  attachFn(context, scopeObj, 'fts', (args) => {
    const query = args[0];
    if (typeof query !== 'string' || !query.trim()) return [];
    const opts = (args[1] ?? {}) as { limit?: number };
    const limit = Math.min(Math.max(opts.limit ?? 20, 1), 100);
    return ftsQueryImpl(reader, scope, query, limit);
  });

  // -- vec(query, opts?) -------------------------------------------------
  attachFn(context, scopeObj, 'vec', (args) => {
    const query = args[0];
    if (typeof query !== 'string' || !query.trim()) return [];
    const opts = (args[1] ?? {}) as { limit?: number };
    const limit = Math.min(Math.max(opts.limit ?? 20, 1), 100);
    const cached = deps.queryEmbeddings?.get(query);
    if (!cached) return [];
    return vecQueryImpl(reader, scope, cached, limit);
  });

  // -- hybrid(query, opts?) ----------------------------------------------
  attachFn(context, scopeObj, 'hybrid', (args) => {
    const query = args[0];
    if (typeof query !== 'string' || !query.trim()) return [];
    const opts = (args[1] ?? {}) as { limit?: number; rrf_k?: number };
    const limit = Math.min(Math.max(opts.limit ?? 20, 1), 100);
    const rrfK = opts.rrf_k ?? 60;
    const fetchLimit = Math.min(limit * 2, 100);

    const ftsResults = ftsQueryImpl(reader, scope, query, fetchLimit);
    const cached = deps.queryEmbeddings?.get(query);
    const vecResults = cached
      ? vecQueryImpl(reader, scope, cached, fetchLimit)
      : [];

    return rrfFuse(ftsResults, vecResults, rrfK, limit);
  });

  // -- get(id) -----------------------------------------------------------
  attachFn(context, scopeObj, 'get', (args) => {
    const id = args[0];
    if (typeof id !== 'string') return null;
    return nodeGet(reader, scope, id);
  });

  // -- index(opts?) — Phase 7.5: browsable table of contents ---------------
  attachFn(context, scopeObj, 'index', (args) => {
    const opts = (args[0] ?? {}) as { kind?: string; source_uri?: string; limit?: number };
    const limit = Math.min(Math.max(opts.limit ?? 500, 1), 2000);
    return indexQuery(reader, scope, limit, opts.kind, opts.source_uri);
  });

  // -- neighbors(id, opts?) ----------------------------------------------
  attachFn(context, scopeObj, 'neighbors', (args) => {
    const id = args[0];
    if (typeof id !== 'string') return [];
    const opts = (args[1] ?? {}) as { depth?: number; edge_kinds?: string[] };
    const depth = Math.min(Math.max(opts.depth ?? 1, 1), 3);
    return neighborsQuery(reader, scope, id, depth, opts.edge_kinds);
  });

  // -- log.recent(n?, opts?) ---------------------------------------------
  attachFn(context, logObj, 'recent', (args) => {
    const n = typeof args[0] === 'number' ? Math.min(Math.max(args[0], 1), 100) : 20;
    const opts = (args[1] ?? {}) as { kind?: string };
    return logRecent(reader, scope, n, opts.kind);
  });

  // -- gaps(opts?) — Phase 6: query kg_gaps for concept gaps ---------------
  attachFn(context, scopeObj, 'gaps', (args) => {
    const opts = (args[0] ?? {}) as { resolved?: boolean };
    return queryGaps(reader, scope, opts);
  });

  // -- pagerank(opts?) — D40: PageRank scores based on wikilink graph -------
  attachFn(context, scopeObj, 'pagerank', (args) => {
    const opts = (args[0] ?? {}) as { iterations?: number; limit?: number; damping?: number };
    return pagerank(reader, scope, opts);
  });

  // -- components(opts?) — D40: connected components in the wikilink graph --
  attachFn(context, scopeObj, 'components', () => {
    return connectedComponents(reader, scope);
  });

  // -- write(path, content) ----------------------------------------------
  attachThrowingFn(context, scopeObj, 'write', (args) => {
    if (!deps.wikiRoot || !deps.writeCounter) {
      throw new Error('write bindings not available (no wikiRoot configured)');
    }
    const path = args[0];
    const content = args[1];
    if (typeof path !== 'string') throw new Error('write: path must be a string');
    if (typeof content !== 'string') throw new Error('write: content must be a string');
    return writeWikiFile(deps.wikiRoot, path, content, deps.writeCounter, scope, bundle.writer);
  });

  // -- append(entry) -----------------------------------------------------
  attachThrowingFn(context, scopeObj, 'append', (args) => {
    if (!deps.wikiRoot || !deps.writeCounter) {
      throw new Error('append bindings not available (no wikiRoot configured)');
    }
    const entry = args[0];
    if (typeof entry !== 'string') throw new Error('append: entry must be a string');
    return appendWikiLog(deps.wikiRoot, entry, deps.writeCounter, scope, bundle.writer);
  });

  // -- remove(path) ------------------------------------------------------
  attachThrowingFn(context, scopeObj, 'remove', (args) => {
    if (!deps.wikiRoot || !deps.writeCounter) {
      throw new Error('remove bindings not available (no wikiRoot configured)');
    }
    const path = args[0];
    if (typeof path !== 'string') throw new Error('remove: path must be a string');
    return removeWikiFile(deps.wikiRoot, path, deps.writeCounter, scope, bundle.writer);
  });

  // Wire nesting: scope.log
  context.setProp(scopeObj, 'log', logObj);
}

/**
 * Install backward-compat `kg.search()` and `kg.get()` aliases.
 * Always routes to the project scope.
 */
function installBackwardCompat(
  context: QuickJSContext,
  kgObj: QuickJSHandle,
  deps: KgBindingDeps
): void {
  const { repository, scope } = deps;

  attachFn(context, kgObj, 'search', (args) => {
    const query = args[0];
    if (typeof query !== 'string') return [];
    return repository.search(query, scope).map((c) => ({
      id: c.id,
      text: c.text,
      source_uri: c.source_uri,
    }));
  });

  attachFn(context, kgObj, 'get', (args) => {
    const id = args[0];
    if (typeof id !== 'string') return null;
    const c = repository.get(id, scope);
    if (!c) return null;
    return { id: c.id, text: c.text, source_uri: c.source_uri };
  });
}

/**
 * Return summary metadata for a scope (no content, just counts).
 */
function describeScope(deps: KgBindingDeps): { chunks: number; nodes: number } {
  const reader = nextReader(deps.bundle);
  const chunks = reader
    .prepare<[string], { c: number }>(
      `SELECT count(*) AS c FROM kg_chunks ch JOIN kg_nodes n ON ch.node_id = n.id WHERE n.scope = ?`
    )
    .get(deps.scope)?.c ?? 0;
  const nodes = reader
    .prepare<[string], { c: number }>(
      `SELECT count(*) AS c FROM kg_nodes WHERE scope = ?`
    )
    .get(deps.scope)?.c ?? 0;
  return { chunks, nodes };
}

// ============================================================================
// SQL query implementations
// ============================================================================

function nodeGet(
  reader: BetterSqliteDatabase,
  scope: string,
  id: string
): {
  id: string;
  source_uri: string;
  section_path: string;
  kind: string;
  title: string | null;
  content: string;
  token_count: number;
  confidence: string;
} | null {
  const row = reader
    .prepare<
      [string, string],
      {
        id: string;
        source_uri: string;
        section_path: string;
        kind: string;
        title: string | null;
        content: string;
        token_count: number;
        confidence: string;
      }
    >(
      `SELECT id, source_uri, section_path, kind, title, content, token_count, confidence
         FROM kg_nodes
        WHERE id = ? AND scope = ?
        LIMIT 1`
    )
    .get(id, scope);

  return row ?? null;
}

function indexQuery(
  reader: BetterSqliteDatabase,
  scope: string,
  limit: number,
  kind?: string,
  sourceUri?: string
): Array<{
  id: string;
  title: string | null;
  source_uri: string;
  section_path: string;
  kind: string;
  token_count: number;
}> {
  let sql = `SELECT id, title, source_uri, section_path, kind, token_count
     FROM kg_nodes
    WHERE scope = ?`;
  const params: unknown[] = [scope];

  if (kind) {
    sql += ` AND kind = ?`;
    params.push(kind);
  }
  if (sourceUri) {
    sql += ` AND source_uri = ?`;
    params.push(sourceUri);
  }

  sql += ` ORDER BY source_uri, section_path LIMIT ?`;
  params.push(limit);

  return reader.prepare(sql).all(...params) as Array<{
    id: string;
    title: string | null;
    source_uri: string;
    section_path: string;
    kind: string;
    token_count: number;
  }>;
}

function neighborsQuery(
  reader: BetterSqliteDatabase,
  scope: string,
  id: string,
  maxDepth: number,
  edgeKinds?: string[]
): Array<{
  id: string;
  source_uri: string;
  section_path: string;
  kind: string;
  title: string | null;
  depth: number;
}> {
  let edgeFilter = '';
  const params: unknown[] = [id, maxDepth];
  if (edgeKinds && edgeKinds.length > 0) {
    const placeholders = edgeKinds.map(() => '?').join(',');
    edgeFilter = `AND e.edge_kind IN (${placeholders})`;
    params.push(...edgeKinds);
  }
  params.push(id, scope);

  const sql = `
    WITH RECURSIVE hops(node_id, depth) AS (
      VALUES(?, 0)
      UNION ALL
      SELECT e.dst_id, h.depth + 1
        FROM hops h
        JOIN kg_edges e ON e.src_id = h.node_id
       WHERE h.depth < ? ${edgeFilter}
    )
    SELECT DISTINCT n.id, n.source_uri, n.section_path, n.kind, n.title, h.depth
      FROM hops h
      JOIN kg_nodes n ON n.id = h.node_id
     WHERE n.id != ? AND n.scope = ?`;

  return reader.prepare(sql).all(...params) as Array<{
    id: string;
    source_uri: string;
    section_path: string;
    kind: string;
    title: string | null;
    depth: number;
  }>;
}

function logRecent(
  reader: BetterSqliteDatabase,
  scope: string,
  n: number,
  kind?: string
): Array<{
  id: number;
  ts: number;
  kind: string;
  source_uri: string | null;
  payload: unknown;
}> {
  let sql: string;
  let params: unknown[];

  if (kind) {
    sql = `SELECT id, ts, kind, source_uri, payload
             FROM kg_log
            WHERE scope = ? AND kind = ?
            ORDER BY ts DESC
            LIMIT ?`;
    params = [scope, kind, n];
  } else {
    sql = `SELECT id, ts, kind, source_uri, payload
             FROM kg_log
            WHERE scope = ?
            ORDER BY ts DESC
            LIMIT ?`;
    params = [scope, n];
  }

  const rows = reader.prepare(sql).all(...params) as Array<{
    id: number;
    ts: number;
    kind: string;
    source_uri: string | null;
    payload: string | null;
  }>;

  return rows.map((r) => ({
    id: r.id,
    ts: r.ts,
    kind: r.kind,
    source_uri: r.source_uri,
    payload: r.payload ? tryParseJson(r.payload) : null,
  }));
}

// ============================================================================
// Helpers
// ============================================================================

function tryParseJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}

function attachFn(
  context: QuickJSContext,
  obj: QuickJSHandle,
  name: string,
  impl: (args: unknown[]) => unknown
): void {
  const fn = context.newFunction(name, (...handles: QuickJSHandle[]) => {
    try {
      const nativeArgs = handles.map((h) => context.dump(h));
      const result = impl(nativeArgs);
      return marshalJsValue(context, result);
    } catch (e) {
      return context.newError(errorMessage(e));
    }
  });
  context.setProp(obj, name, fn);
  fn.dispose();
}

function attachThrowingFn(
  context: QuickJSContext,
  obj: QuickJSHandle,
  name: string,
  impl: (args: unknown[]) => unknown
): void {
  const fn = context.newFunction(name, (...handles: QuickJSHandle[]) => {
    try {
      const nativeArgs = handles.map((h) => context.dump(h));
      const result = impl(nativeArgs);
      return marshalJsValue(context, result);
    } catch (e) {
      return { error: context.newError(errorMessage(e)) };
    }
  });
  context.setProp(obj, name, fn);
  fn.dispose();
}
