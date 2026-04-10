import { z } from 'zod';

import type { Repository } from '../../db/repository.js';
import type { DbBundle } from '../../db/client.js';
import type { QuickJSExecutor } from '../../sandbox/executor.js';
import type { Embedder } from '../../retrieval/embedder.js';
import { countEnvelopeTokens, countTokens, computeInternalBudget, fitResults } from '../../gate/budget.js';
import { buildEnvelope, QueryTimer, type Scope } from '../envelope.js';
import type { BindingDeps } from '../../sandbox/bindings/install.js';

/**
 * `kg_execute` — code-mode tool. The LLM writes a short JS snippet, we run
 * it inside the QuickJS sandbox against the `kg` bindings, and return the
 * (budget-shaped) result.
 *
 * Phase 3: full `kg.project.*` binding surface via warm pool. Backward-compat
 * `kg.search()`/`kg.get()` aliases remain.
 */

const KG_EXECUTE_TYPES = `
declare const kg: {
  /** Substring search (backward compat). */
  search(query: string): Array<{ id: string; text: string; source_uri: string }>;
  /** Chunk lookup by id (backward compat). */
  get(id: string): { id: string; text: string; source_uri: string } | null;
  project: {
    /** FTS5 full-text search with bm25 ranking. */
    fts(query: string, opts?: { limit?: number }): Array<{ id: string; text: string; source_uri: string; node_id: string; rank: number; title: string | null; section_path: string }>;
    /** Vector similarity search. Returns [] if no pre-computed embedding available. */
    vec(query: string, opts?: { limit?: number }): Array<{ id: string; text: string; source_uri: string; node_id: string; distance: number; title: string | null; section_path: string }>;
    /** Hybrid FTS + vector search with RRF fusion. Falls back to FTS-only if no embedding cached. */
    hybrid(query: string, opts?: { limit?: number; rrf_k?: number }): Array<{ id: string; text: string; source_uri: string; node_id: string; score: number; snippet?: string; title: string | null; section_path: string }>;
    /** Table of contents — list all nodes for LLM-driven browsing. Use this to scan titles, then get(id) to read specific sections. */
    index(opts?: { kind?: string; source_uri?: string; limit?: number }): Array<{ id: string; title: string | null; source_uri: string; section_path: string; kind: string; token_count: number }>;
    /** Node lookup by id — full section content. */
    get(id: string): { id: string; source_uri: string; section_path: string; kind: string; title: string | null; content: string; token_count: number } | null;
    /** K-hop graph traversal. */
    neighbors(id: string, opts?: { depth?: number; edge_kinds?: string[] }): Array<{ id: string; source_uri: string; kind: string; title: string | null; depth: number }>;
    log: {
      /** Recent log entries. */
      recent(n?: number, opts?: { kind?: string }): Array<{ id: number; ts: number; kind: string; source_uri: string | null; payload: unknown }>;
    };
    /** Concept gaps — topics mentioned ≥3 times with no dedicated wiki page. Check these to find what the wiki is missing, then write() to fill them. */
    gaps(opts?: { resolved?: boolean }): Array<{ id: number; topic: string; first_seen_at: number; mentions_count: number; resolved_at: number | null }>;
    /** Create or overwrite a wiki page. Path is relative to wiki root, .md extension enforced. */
    write(path: string, content: string): { path: string; bytes: number };
    /** Append a timestamped entry to log.md. */
    append(entry: string): { path: string; bytes: number };
    /** Delete a wiki page. Path is relative to wiki root. */
    remove(path: string): { path: string; removed: true };
  };
};
declare const budget: { fit(items: unknown[], maxTokens?: number): unknown[] };
declare const logger: { log(...args: unknown[]): void };
`.trim();

export const kgExecuteInputShape = {
  code: z
    .string()
    .min(1)
    .describe(
      'JavaScript to run inside the sandbox. The sandbox is QuickJS with ' +
        '`eval`, `Function`, `fetch`, `require`, `process`, and `constructor` ' +
        'removed. You have `kg.project.*` for FTS, graph traversal, log ' +
        'queries, and wiki writes (write/append/remove), plus `budget.fit()` ' +
        'for token-aware truncation and `logger.log()` captured into ' +
        '`response.logs`. Return a value.\n' +
        KG_EXECUTE_TYPES
    ),
  max_tokens: z
    .number()
    .int()
    .positive()
    .max(20_000)
    .optional()
    .describe(
      'Maximum total tokens the response can contain. Default 5000, max 20000.'
    ),
  timeout_ms: z
    .number()
    .int()
    .positive()
    .max(10_000)
    .optional()
    .describe(
      'Hard wall-clock execution timeout for the sandbox. Default 2000ms, ' +
        'max 10000ms. If exceeded, the response contains an `error` string.'
    ),
  scope: z
    .enum(['project', 'personal', 'both'])
    .optional()
    .describe(
      'Which KG bindings to inject. "project" (default) installs kg.project, ' +
        '"personal" installs kg.personal, "both" installs both namespaces.'
    ),
};

export const kgExecuteToolConfig = {
  title: 'Run JS in the knowledge-graph sandbox',
  description:
    'Run a short JavaScript snippet inside the KG sandbox. The KG indexes a ' +
    'curated markdown wiki of project knowledge (architecture decisions, ' +
    'conventions, concepts) — not the source code. Use grep/read for source ' +
    'files; use this for wiki content.\n\n' +
    'Read: `kg.project.index()` to browse the wiki TOC, `kg.project.get(id)` for ' +
    'full content, `kg.project.hybrid()` for search, `kg.project.neighbors()` ' +
    'for graph traversal, `kg.project.log.recent()` for event log.\n\n' +
    'Write: `kg.project.write(path, content)` to create/update wiki pages, ' +
    '`kg.project.append(entry)` to add log entries, `kg.project.remove(path)` ' +
    'to delete.\n\n' +
    'Gaps: `kg.project.gaps()` returns concepts mentioned ≥3 times in the wiki ' +
    'that have no dedicated page — use this to discover what knowledge is missing ' +
    'and fill it with write().\n\n' +
    '64MB memory cap, 2s default timeout. No network, no eval.\n\n' +
    KG_EXECUTE_TYPES,
  inputSchema: kgExecuteInputShape,
} as const;

export interface KgExecuteDeps {
  repository: Repository;
  executor: QuickJSExecutor;
  bundle: DbBundle;
  embedder: Embedder;
  wikiRoot?: string;
  personalBundle?: DbBundle;
  personalWikiRoot?: string;
}

/**
 * Build the `kg_execute` handler. Phase 3 path: uses `executeWithBindings`
 * with the full `kg.project.*` surface via the warm pool.
 */
export function makeKgExecuteHandler(deps: KgExecuteDeps) {
  return async (args: {
    code: string;
    max_tokens?: number;
    timeout_ms?: number;
    scope?: 'project' | 'personal' | 'both';
  }): Promise<{ content: [{ type: 'text'; text: string }]; isError?: boolean }> => {
    const timer = new QueryTimer();
    const maxTokens = args.max_tokens ?? 5000;
    const scope: Scope = args.scope ?? 'project';

    // Check that personal scope is available if requested
    if ((scope === 'personal' || scope === 'both') && !deps.personalBundle) {
      const envelope = buildEnvelope({
        result: {
          error:
            'personal scope requested but no personal KG is configured — ' +
            'set KG_PROFILE_PATH or pass --profile-path',
        },
        tokensBudgeted: maxTokens,
        tokensUsed: 0,
        resultsTruncated: false,
        scope,
        queryTimeMs: timer.end(),
      });
      return wrapText(envelope);
    }

    const logs: string[] = [];
    const writeCounter = { value: 0 };

    // Build per-scope binding deps. Privacy invariant: only include
    // the scope(s) the caller requested.
    const bindingDeps: BindingDeps = { maxTokens, logs };

    if (scope === 'project' || scope === 'both') {
      bindingDeps.project = {
        repository: deps.repository,
        bundle: deps.bundle,
        scope: 'project',
        embedder: deps.embedder,
        wikiRoot: deps.wikiRoot,
        writeCounter,
      };
    }
    if ((scope === 'personal' || scope === 'both') && deps.personalBundle) {
      bindingDeps.personal = {
        repository: deps.repository,
        bundle: deps.personalBundle,
        scope: 'personal',
        embedder: deps.embedder,
        wikiRoot: deps.personalWikiRoot,
        writeCounter,
      };
    }

    const result = await deps.executor.executeWithBindings(
      args.code,
      bindingDeps,
      args.timeout_ms
    );

    // Executor errors are in-payload per CLAUDE.md §API Rules #8.
    if (result.error) {
      const envelope = buildEnvelope({
        result: { error: result.error },
        tokensBudgeted: maxTokens,
        tokensUsed: 0,
        resultsTruncated: false,
        scope,
        queryTimeMs: timer.end(),
        logs: result.logs,
      });
      const json = JSON.stringify(envelope);
      envelope.meta.tokens_used = countEnvelopeTokens(json);
      return wrapText(envelope);
    }

    // Apply the budget gate. If the result is an array, fitResults does
    // the greedy truncation we want. If the result is a scalar or object,
    // we check its total size and replace it with a truncation notice
    // rather than emitting a too-large sentinel (which only makes sense
    // for rank-ordered results).
    const raw = result.result;
    const { shapedResult, truncated, tokensUsed, tokensBudgeted } =
      shapeForBudget(raw, maxTokens);

    const envelope = buildEnvelope({
      result: shapedResult,
      tokensBudgeted,
      tokensUsed,
      resultsTruncated: truncated,
      scope,
      queryTimeMs: timer.end(),
      logs: result.logs,
    });
    const json = JSON.stringify(envelope);
    envelope.meta.tokens_used = countEnvelopeTokens(json);
    return wrapText(envelope);
  };
}

/**
 * Budget-shape the raw result of a sandbox execution. For array results
 * we reuse `fitResults` with a synthetic id/uri extractor. For non-array
 * results we measure the whole thing and replace it with a truncation
 * notice if it overflows.
 */
function shapeForBudget(
  raw: unknown,
  maxTokens: number
): {
  shapedResult: unknown;
  truncated: boolean;
  tokensUsed: number;
  tokensBudgeted: number;
} {
  const budget = computeInternalBudget(maxTokens);

  if (Array.isArray(raw)) {
    let arrayIdx = 0;
    const fit = fitResults<unknown>(
      raw,
      maxTokens,
      (item) => JSON.stringify(item),
      (item) => {
        // Try to pull a stable id out of the item if it has one,
        // otherwise fall back to an array-index pseudo-id.
        const obj = item as { id?: unknown } | null;
        if (obj && typeof obj.id === 'string') return obj.id;
        return `[${arrayIdx++}]`;
      },
      (item) => {
        const obj = item as { source_uri?: unknown } | null;
        return obj && typeof obj.source_uri === 'string' ? obj.source_uri : '';
      }
    );
    return {
      shapedResult: fit.kept,
      truncated: fit.truncated,
      tokensUsed: fit.tokensUsed,
      tokensBudgeted: fit.tokensBudgeted,
    };
  }

  // Scalar, object, null, etc. — measure the whole thing.
  const json = JSON.stringify(raw);
  const cost = countTokens(json ?? 'null');
  if (cost <= budget) {
    return {
      shapedResult: raw,
      truncated: false,
      tokensUsed: cost,
      tokensBudgeted: budget,
    };
  }
  // Too large for a scalar result. Replace with an error string so the
  // LLM can retry with a higher max_tokens or re-query more narrowly.
  return {
    shapedResult: {
      error:
        `result body is ${cost} tokens, which exceeds the internal budget ` +
        `of ${budget} (max_tokens=${maxTokens}). Re-query with a higher ` +
        `max_tokens or narrow your code to return fewer fields.`,
    },
    truncated: true,
    tokensUsed: countTokens(
      JSON.stringify({ error: 'placeholder' })
    ),
    tokensBudgeted: budget,
  };
}

function wrapText(envelope: unknown): { content: [{ type: 'text'; text: string }] } {
  return { content: [{ type: 'text', text: JSON.stringify(envelope) }] };
}
