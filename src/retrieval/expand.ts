import type { LlmProvider } from '../llm/provider.js';
import { logger } from '../observability/logger.js';

/**
 * Multi-query expansion (D38, GBrain-inspired).
 *
 * Uses an LLM to generate 2 alternative phrasings of a search query,
 * improving recall for ambiguous or jargon-heavy queries. Results from
 * all query variants are merged via RRF in the caller.
 *
 * Non-fatal: if the provider is unavailable or the call fails, returns
 * empty alternatives and the caller uses the original query only.
 */

const EXPANSION_SYSTEM = `You generate alternative search phrasings. Given a query, produce exactly 2 alternative phrasings that could help find relevant results. Return ONLY a JSON array of exactly 2 strings, no explanation.`;

/** Module-level cache: query → alternatives. Max 100 entries, no TTL. */
const cache = new Map<string, string[]>();
const MAX_CACHE = 100;

export interface ExpandResult {
  original: string;
  alternatives: string[];
}

/**
 * Expand a query into 2 alternative phrasings via an LLM.
 *
 * Returns `{ original, alternatives: [] }` if:
 * - Provider is not available
 * - Query is too short (< 3 words — expansion adds noise for short queries)
 * - LLM call fails (non-fatal)
 * - Response can't be parsed as a JSON array of strings
 */
export async function expandQuery(
  query: string,
  provider: LlmProvider
): Promise<ExpandResult> {
  const original = query.trim();

  // Short queries don't benefit from expansion
  if (original.split(/\s+/).length < 3) {
    return { original, alternatives: [] };
  }

  if (!provider.available()) {
    return { original, alternatives: [] };
  }

  // Check cache
  const cached = cache.get(original);
  if (cached) {
    return { original, alternatives: cached };
  }

  try {
    const response = await provider.complete({
      system: EXPANSION_SYSTEM,
      prompt: original,
      maxTokens: 100,
    });

    const alternatives = parseAlternatives(response);
    if (alternatives.length > 0) {
      // LRU-ish eviction: delete oldest entry if at capacity
      if (cache.size >= MAX_CACHE) {
        const firstKey = cache.keys().next().value;
        if (firstKey !== undefined) cache.delete(firstKey);
      }
      cache.set(original, alternatives);
    }

    return { original, alternatives };
  } catch (err) {
    logger.warn({ err, query: original }, 'query expansion failed (non-fatal)');
    return { original, alternatives: [] };
  }
}

/**
 * Parse the LLM response as a JSON array of 2 strings.
 * Returns empty array on any parse failure.
 */
function parseAlternatives(response: string): string[] {
  try {
    // Try to extract JSON array from the response (may have surrounding text)
    const match = response.match(/\[[\s\S]*\]/);
    if (!match) return [];

    const parsed: unknown = JSON.parse(match[0]);
    if (!Array.isArray(parsed)) return [];

    const strings = parsed
      .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
      .map((s) => s.trim())
      .slice(0, 2);

    return strings;
  } catch {
    return [];
  }
}

/** Clear the cache — test-only. */
export function __clearExpansionCacheForTests(): void {
  cache.clear();
}
