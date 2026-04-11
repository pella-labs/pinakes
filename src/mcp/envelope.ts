/**
 * MCP tool response envelope.
 *
 * CLAUDE.md §API Rules #5 — the envelope is immutable. Adding a field
 * requires updating this file and regenerating the tool schemas. The LLM
 * consumer parses this shape, so drift here breaks prompts in the wild.
 */

export type Scope = 'project' | 'personal' | 'both';

export interface EnvelopeMeta {
  /** User-requested `max_tokens` (default 5000, max 20000). */
  tokens_budgeted: number;
  /** Actual token count of the final serialized response body. */
  tokens_used: number;
  /** True if the budget gate truncated results or emitted a sentinel. */
  results_truncated: boolean;
  /** Scope this call ran against. */
  scope: Scope;
  /** Wall-clock time from tool entry to envelope build. */
  query_time_ms: number;
  /**
   * Files whose on-disk `source_sha` no longer matches the indexed copy.
   * Always empty in Phase 1 (in-memory store, no staleness concept).
   * Phase 2+ populates this after the staleness check.
   */
  stale_files: string[];
}

/**
 * The canonical response wrapper for both `search` and `execute`.
 *
 * `result` is the tool-specific payload. `meta` is always present and
 * always has every field populated. `logs` is optional — present when the
 * tool invoked `logger.log()` inside the sandbox, or when ingestion emitted
 * warnings worth surfacing.
 *
 * Errors go inside `result` (e.g. `{ result: { error: "..." } }`) rather
 * than being thrown or marked with `isError: true`, per CLAUDE.md
 * §API Rules #8 — Claude Code has a bug where protocol-level errors display
 * as "Error: undefined", and stuffing the error into the payload is the
 * only way to keep it visible.
 */
export interface Envelope<T> {
  result: T;
  meta: EnvelopeMeta;
  logs?: string[];
}

/**
 * Build an envelope from its parts. Kept as a helper so the field order is
 * stable (JSON stringification cares) and so the caller cannot forget a
 * required meta field.
 */
export function buildEnvelope<T>(params: {
  result: T;
  tokensBudgeted: number;
  tokensUsed: number;
  resultsTruncated: boolean;
  scope: Scope;
  queryTimeMs: number;
  staleFiles?: string[];
  logs?: string[];
}): Envelope<T> {
  const envelope: Envelope<T> = {
    result: params.result,
    meta: {
      tokens_budgeted: params.tokensBudgeted,
      tokens_used: params.tokensUsed,
      results_truncated: params.resultsTruncated,
      scope: params.scope,
      query_time_ms: params.queryTimeMs,
      stale_files: params.staleFiles ?? [],
    },
  };
  if (params.logs && params.logs.length > 0) {
    envelope.logs = params.logs;
  }
  return envelope;
}

/**
 * Helper for measuring query wall-clock time. Captures a start timestamp
 * on construction and returns the elapsed ms when `end()` is called. Using
 * `performance.now()` instead of `Date.now()` for sub-ms resolution — the
 * cold-start benchmark gate in Phase 1 tests #6 is measuring p50 at the
 * 100ms scale, so millisecond precision matters.
 */
export class QueryTimer {
  private readonly startMs: number;

  constructor() {
    this.startMs = performance.now();
  }

  end(): number {
    return Math.round(performance.now() - this.startMs);
  }
}
