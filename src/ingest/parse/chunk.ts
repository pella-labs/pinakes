import { countTokens } from '../../gate/budget.js';

/**
 * Paragraph-aware chunker for Pinakes Phase 2.
 *
 * Splits a section's body into chunks of approximately `targetTokens` tokens,
 * never breaking a paragraph in half. Tokens are counted via the existing
 * `countTokens()` from `gate/budget.ts`, which uses `js-tiktoken p50k_base`
 * with the long-string fast path (D32 — see CLAUDE.md §API Rules #6 budget math).
 *
 * **Algorithm**:
 *   1. Split the input on blank lines (`\n\n+`) into paragraphs
 *   2. Iterate paragraphs left to right, accumulating into a current chunk
 *   3. If adding the next paragraph would push the chunk past `targetTokens`,
 *      flush the current chunk and start a new one with that paragraph
 *   4. A single oversize paragraph that ALONE exceeds `targetTokens` gets
 *      its own chunk (rather than being split mid-sentence — the LLM can
 *      still query it via FTS5, just slower)
 *
 * **Determinism**: same input → same output. The chunker is pure: no random
 * tie-breaking, no time-based decisions, no environment lookups. The
 * downstream `chunk_sha = sha1(chunk_text)` therefore stays stable across
 * runs, which is the load-bearing assumption for the per-chunk skip-unchanged
 * optimization (CLAUDE.md §Database Rules #3, Loop 6.5 A4).
 *
 * **Why ~500 tokens?** Empirical sweet spot for retrieval: small enough that
 * each chunk is a focused topic, large enough that 1-2 chunks usually answer
 * a query without needing to fetch a whole node. Phase 4's RRF + budget gate
 * tunes around this size; deviating significantly will affect retrieval
 * quality. The actual chunk sizes will fluctuate around this target since
 * we won't break a paragraph — chunks may be smaller (single short paragraph)
 * or larger (single long paragraph).
 */

const DEFAULT_TARGET_TOKENS = 500;

export interface Chunk {
  /** Chunk text — paragraphs joined by blank lines, original whitespace preserved */
  text: string;
  /** Cached token count — exposed so the ingester doesn't need to recount */
  token_count: number;
}

/**
 * Split a section's content into ~target_tokens-sized chunks on paragraph
 * boundaries. Returns an empty array for input with no non-whitespace content.
 *
 * `targetTokens` defaults to 500. Pass a smaller value in tests if you want
 * to force a section to chunk at a predictable boundary.
 */
export function chunkSection(content: string, targetTokens: number = DEFAULT_TARGET_TOKENS): Chunk[] {
  const paragraphs = splitParagraphs(content);
  if (paragraphs.length === 0) return [];

  const chunks: Chunk[] = [];
  let current: string[] = [];
  let currentTokens = 0;

  for (const para of paragraphs) {
    const paraTokens = countTokens(para);

    // Edge case: paragraph alone exceeds target — emit it as its own chunk
    // (rather than splitting mid-sentence, which would hurt retrieval and
    // also break round-trip determinism).
    if (paraTokens > targetTokens) {
      if (current.length > 0) {
        chunks.push({ text: current.join('\n\n'), token_count: currentTokens });
        current = [];
        currentTokens = 0;
      }
      chunks.push({ text: para, token_count: paraTokens });
      continue;
    }

    // If adding this paragraph would exceed target, flush current and start fresh.
    if (currentTokens + paraTokens > targetTokens && current.length > 0) {
      chunks.push({ text: current.join('\n\n'), token_count: currentTokens });
      current = [];
      currentTokens = 0;
    }

    current.push(para);
    currentTokens += paraTokens;
  }

  // Flush the trailing chunk.
  if (current.length > 0) {
    chunks.push({ text: current.join('\n\n'), token_count: currentTokens });
  }

  return chunks;
}

/**
 * Split a string on blank lines, trimming each paragraph and dropping empty
 * ones. Mirrors the Phase 1 splitParagraphs in memory-store.ts so chunking
 * behavior stays consistent across the swap.
 */
function splitParagraphs(source: string): string[] {
  return source
    .split(/\r?\n\r?\n+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}
