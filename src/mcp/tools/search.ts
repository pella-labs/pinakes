import { z } from 'zod';

import type { Repository } from '../../db/repository.js';
import type { DbBundle } from '../../db/client.js';
import type { Embedder } from '../../retrieval/embedder.js';
import { hybridSearch } from '../../retrieval/hybrid.js';
import { fitResults, countEnvelopeTokens } from '../../gate/budget.js';
import { buildEnvelope, QueryTimer, type Scope } from '../envelope.js';
import { nextReader } from '../../db/client.js';

/**
 * `kg_search` — fast-path hybrid search against the knowledge graph.
 *
 * Phase 5: supports all three scopes. For `scope='both'`, results from
 * both KGs are merged and tagged with `source_scope`.
 */

export const kgSearchInputShape = {
  query: z
    .string()
    .min(1)
    .describe(
      'The search term. Hybrid FTS5 + vector search against every indexed ' +
        'chunk of the wiki, ranked by Reciprocal Rank Fusion. ' +
        'Examples: "hashPassword", "bcrypt", "auth flow".'
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
      'Which KG to query. "project" (default) searches the project wiki, ' +
        '"personal" searches the personal wiki, "both" merges results from ' +
        'both with `source_scope` tagging on each result.'
    ),
};

export const kgSearchToolConfig = {
  title: 'Search the knowledge graph',
  description:
    'Hybrid FTS + vector search the curated project knowledge wiki (not source ' +
    'code — use grep/read for that). Best for conceptual questions about ' +
    'architecture, conventions, and decisions. Results are ranked by Reciprocal ' +
    'Rank Fusion with `title` and `section_path` for quick triage. ' +
    'Prefer this for short lookups; use `kg_execute` when you need to chain ' +
    'filters, browse the wiki index, write new pages, or check knowledge gaps.',
  inputSchema: kgSearchInputShape,
} as const;

export interface KgSearchDeps {
  repository: Repository;
  embedder: Embedder;
  bundle: DbBundle;
  personalBundle?: DbBundle;
}

interface TaggedResult {
  id: string;
  text: string;
  source_uri: string;
  score: number;
  confidence: string;
  title: string | null;
  section_path: string;
  source_scope?: 'project' | 'personal';
}

/**
 * Build the `kg_search` handler. Supports project, personal, and both scopes.
 */
export function makeKgSearchHandler(deps: KgSearchDeps) {
  return async (args: {
    query: string;
    max_tokens?: number;
    scope?: 'project' | 'personal' | 'both';
  }): Promise<{ content: [{ type: 'text'; text: string }]; isError?: boolean }> => {
    const timer = new QueryTimer();
    const maxTokens = args.max_tokens ?? 5000;
    const scope: Scope = args.scope ?? 'project';

    // Check personal scope availability
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

    let allHits: TaggedResult[] = [];

    if (scope === 'project' || scope === 'both') {
      const reader = nextReader(deps.bundle);
      const hits = await hybridSearch(reader, 'project', args.query, deps.embedder);
      const tagged: TaggedResult[] = hits.map((h) => ({
        id: h.id, text: h.text, source_uri: h.source_uri, score: h.score,
        confidence: h.confidence, title: h.title, section_path: h.section_path,
        ...(scope === 'both' ? { source_scope: 'project' as const } : {}),
      }));
      allHits.push(...tagged);
    }

    if ((scope === 'personal' || scope === 'both') && deps.personalBundle) {
      const reader = nextReader(deps.personalBundle);
      const hits = await hybridSearch(reader, 'personal', args.query, deps.embedder);
      const tagged: TaggedResult[] = hits.map((h) => ({
        id: h.id, text: h.text, source_uri: h.source_uri, score: h.score,
        confidence: h.confidence, title: h.title, section_path: h.section_path,
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
