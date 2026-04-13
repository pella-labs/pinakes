import { z } from 'zod';

import type { Repository } from '../../db/repository.js';
import type { DbBundle } from '../../db/client.js';
import type { Embedder } from '../../retrieval/embedder.js';
import type { LlmProvider } from '../../llm/provider.js';
import { hybridSearch, rrfFuseMulti } from '../../retrieval/hybrid.js';
import { dedupResults } from '../../retrieval/dedup.js';
import { expandQuery } from '../../retrieval/expand.js';
import { fitResults, countEnvelopeTokens } from '../../gate/budget.js';
import { buildEnvelope, QueryTimer, type Scope } from '../envelope.js';
import { nextReader } from '../../db/client.js';

/**
 * `search` — fast-path hybrid search against the project knowledge base.
 *
 * Phase 5: supports all three scopes. For `scope='both'`, results from
 * both knowledge bases are merged and tagged with `source_scope`.
 */

export const searchInputShape = {
  query: z
    .string()
    .min(1)
    .describe(
      'Natural language or keyword query. Semantic search finds relevant ' +
        'knowledge even with different wording. ' +
        'Examples: "how does auth work", "database design decisions", "error handling conventions".'
    ),
  max_tokens: z
    .number()
    .int()
    .positive()
    .max(20_000)
    .optional()
    .describe(
      'Maximum total tokens the response can contain. Defaults to 5000, max 20000. ' +
        'The server applies a ~10% safety margin internally. If results would ' +
        'exceed the budget, they are greedy-truncated in rank order and ' +
        '`meta.results_truncated` is set to true.'
    ),
  scope: z
    .enum(['project', 'personal', 'both'])
    .optional()
    .describe(
      'Which knowledge base to query. "project" (default) = this project\'s knowledge, ' +
        '"personal" = your cross-project notes, "both" = merged with source tagging.'
    ),
  expand: z
    .boolean()
    .optional()
    .describe(
      'Set to true to use an LLM for multi-query expansion. Generates 2 ' +
        'alternative phrasings and merges results via RRF for better recall. ' +
        'Requires an LLM provider (Ollama, API key, or Claude/Codex CLI). ' +
        'Non-fatal: falls back to the original query if unavailable.'
    ),
};

export const searchToolConfig = {
  title: 'Search project knowledge base',
  description:
    'START HERE when you need to understand the project — architecture, ' +
    'conventions, decisions, requirements, data models, deployment, or how ' +
    'subsystems relate. Returns distilled knowledge at a fraction of the tokens ' +
    'vs. reading raw source files. Semantic hybrid search (FTS5 + vector) finds ' +
    'relevant context even when you don\'t know exact terms. Results ranked by ' +
    'relevance with `title` and `section_path` for quick triage. ' +
    'Use `execute` for advanced queries: chaining filters, browsing the full ' +
    'index, writing new knowledge, or checking knowledge gaps.',
  inputSchema: searchInputShape,
} as const;

export interface SearchDeps {
  repository: Repository;
  embedder: Embedder;
  bundle: DbBundle;
  personalBundle?: DbBundle;
  llmProvider?: LlmProvider;
}

interface TaggedResult {
  id: string;
  text: string;
  source_uri: string;
  score: number;
  confidence: string;
  effective_confidence?: number;
  title: string | null;
  section_path: string;
  source_scope?: 'project' | 'personal';
}

/**
 * Build the `search` handler. Supports project, personal, and both scopes.
 */
export function makeSearchHandler(deps: SearchDeps) {
  return async (args: {
    query: string;
    max_tokens?: number;
    scope?: 'project' | 'personal' | 'both';
    expand?: boolean;
  }): Promise<{ content: [{ type: 'text'; text: string }]; isError?: boolean }> => {
    const timer = new QueryTimer();
    const maxTokens = args.max_tokens ?? 5000;
    const scope: Scope = args.scope ?? 'project';
    const shouldExpand = args.expand === true;

    // Check personal scope availability
    if ((scope === 'personal' || scope === 'both') && !deps.personalBundle) {
      const envelope = buildEnvelope({
        result: {
          error:
            'personal scope requested but no personal wiki is configured — ' +
            'create a personal wiki at ~/.pinakes/wiki/ or pass --profile-path',
        },
        tokensBudgeted: maxTokens,
        tokensUsed: 0,
        resultsTruncated: false,
        scope,
        queryTimeMs: timer.end(),
      });
      return wrapText(envelope);
    }

    // Determine query variants: original + optional expansions
    const queries = [args.query];
    if (shouldExpand && deps.llmProvider) {
      const expanded = await expandQuery(args.query, deps.llmProvider);
      queries.push(...expanded.alternatives);
    }

    const allHits: TaggedResult[] = [];

    if (scope === 'project' || scope === 'both') {
      const reader = nextReader(deps.bundle);
      // Run hybrid search for all query variants
      const hitLists = await Promise.all(
        queries.map((q) => hybridSearch(reader, 'project', q, deps.embedder, { dedup: false }))
      );
      // If multiple queries, merge via multi-list RRF then dedup
      const merged = hitLists.length > 1
        ? dedupResults(rrfFuseMulti(hitLists, 60, 40)).slice(0, 20)
        : hitLists[0];
      const tagged: TaggedResult[] = merged.map((h) => ({
        id: h.id, text: h.text, source_uri: h.source_uri, score: h.score,
        confidence: h.confidence, effective_confidence: h.effective_confidence, title: h.title, section_path: h.section_path,
        ...(scope === 'both' ? { source_scope: 'project' as const } : {}),
      }));
      allHits.push(...tagged);
    }

    if ((scope === 'personal' || scope === 'both') && deps.personalBundle) {
      const reader = nextReader(deps.personalBundle);
      const hitLists = await Promise.all(
        queries.map((q) => hybridSearch(reader, 'personal', q, deps.embedder, { dedup: false }))
      );
      const merged = hitLists.length > 1
        ? dedupResults(rrfFuseMulti(hitLists, 60, 40)).slice(0, 20)
        : hitLists[0];
      const tagged: TaggedResult[] = merged.map((h) => ({
        id: h.id, text: h.text, source_uri: h.source_uri, score: h.score,
        confidence: h.confidence, effective_confidence: h.effective_confidence, title: h.title, section_path: h.section_path,
        ...(scope === 'both' ? { source_scope: 'personal' as const } : {}),
      }));
      allHits.push(...tagged);
    }

    // For scope='both', re-sort merged results by score descending
    if (scope === 'both') {
      allHits.sort((a, b) => b.score - a.score);
    }

    const fit = fitResults(
      allHits,
      maxTokens,
      (h) => JSON.stringify(h),
      (h) => h.id,
      (h) => h.source_uri
    );

    const envelope = buildEnvelope({
      result: fit.kept.map((item) => {
        if ('too_large' in item) return item;
        return item;
      }),
      tokensBudgeted: fit.tokensBudgeted,
      tokensUsed: 0,
      resultsTruncated: fit.truncated,
      scope,
      queryTimeMs: timer.end(),
    });

    const json = JSON.stringify(envelope);
    envelope.meta.tokens_used = countEnvelopeTokens(json);

    return wrapText(envelope);
  };
}

function wrapText(envelope: unknown): { content: [{ type: 'text'; text: string }] } {
  return { content: [{ type: 'text', text: JSON.stringify(envelope) }] };
}
