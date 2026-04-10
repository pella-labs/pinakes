import { getEncoding, type Tiktoken } from 'js-tiktoken';

/**
 * Token-counting budget gate.
 *
 * Implements CLAUDE.md §API Rules #6 budget math:
 *
 *   envelope_reserve = 500          // bytes set aside for meta/logs/stale_files
 *   safety_margin    = 0.9          // js-tiktoken is an estimator, not an oracle
 *   available        = floor((max_tokens - envelope_reserve) * safety_margin)
 *
 * At the default `max_tokens=5000` the available budget for result bodies is:
 *   floor((5000 - 500) * 0.9) = 4050 tokens
 *
 * Truncation is greedy by rank: keep the highest-ranked item whole if it fits;
 * otherwise emit a `too_large` sentinel so the caller can re-query with a
 * higher `max_tokens` or fetch the node directly by id.
 *
 * The sentinel pattern is Loop 6.5 A3 / presearch.md D22. A single oversize
 * item must NOT blackhole the whole response — we report its id + uri and
 * let the LLM decide what to do next.
 *
 * Token counting uses the `p50k_base` encoder — close enough to Claude's
 * tokenization for budgeting purposes, and the 10% safety margin absorbs the
 * estimation error between tokenizers.
 */

export const ENVELOPE_RESERVE_TOKENS = 500;
export const SAFETY_MARGIN = 0.9;

/**
 * Length threshold above which we skip the real tokenizer and use a
 * conservative character-based estimate instead.
 *
 * js-tiktoken's BPE merge loop is O(n²) on long runs — a 60K-char string
 * takes ~200 seconds to tokenize on current hardware (measured), which is
 * a DoS vector on the budget gate. For any string longer than this
 * threshold we estimate `ceil(length / CHARS_PER_TOKEN_LOWER)`, which
 * always over-counts (since real English is 4+ chars/token), keeping us
 * safely conservative with respect to the budget.
 *
 * Why 8000: at that size tiktoken takes ~2.5s which is already too slow
 * for a request path. Anything under the threshold tokenizes in <50ms,
 * which is acceptable.
 */
const EXACT_TOKENIZE_MAX_CHARS = 8_000;

/**
 * Pessimistic chars-per-token ratio for the estimation path. Real English
 * text runs at 4+ chars per token; we use 3.0 to over-count on purpose so
 * the budget gate stays safe even on token-dense content (code, URLs).
 */
const CHARS_PER_TOKEN_LOWER = 3.0;

const encoder: Tiktoken = getEncoding('p50k_base');

/**
 * Count tokens in a UTF-8 string.
 *
 * Fast path (long strings): return a character-based over-estimate. This
 * is strictly a ceiling — we'd rather emit a few extra `results_truncated`
 * responses than block the event loop for minutes on tokenization.
 *
 * Slow path (short strings): use the real p50k_base encoder for an exact
 * count. This is what matters for normal-size response bodies.
 *
 * The encoder is initialized once at module load and shared across calls.
 */
export function countTokens(text: string): number {
  if (text.length > EXACT_TOKENIZE_MAX_CHARS) {
    return Math.ceil(text.length / CHARS_PER_TOKEN_LOWER);
  }
  return encoder.encode(text).length;
}

/**
 * Given a user-facing `max_tokens` budget, compute the internal result-body
 * budget after subtracting the envelope reserve and applying the safety
 * margin. Always returns a non-negative integer.
 */
export function computeInternalBudget(maxTokens: number): number {
  const raw = Math.floor((maxTokens - ENVELOPE_RESERVE_TOKENS) * SAFETY_MARGIN);
  return Math.max(0, raw);
}

/**
 * A too-large sentinel replaces a single item that would exceed the budget
 * on its own. The shape is deliberately minimal — id + source_uri so the
 * caller can re-query, plus the original token count so they can size a new
 * `max_tokens` request.
 */
export interface TooLargeSentinel {
  too_large: true;
  id: string;
  source_uri: string;
  tokens: number;
}

export interface FitResult<T> {
  kept: Array<T | TooLargeSentinel>;
  truncated: boolean;
  tokensUsed: number;
  tokensBudgeted: number;
}

/**
 * Greedy rank-order truncation. Iterates `items` in the order given (caller
 * is responsible for ranking first), measures each one's serialized token
 * count, and keeps items until the next one would exceed the internal
 * budget.
 *
 * If a single item's token count alone exceeds the budget, it is replaced
 * with a `too_large` sentinel and counted as zero body tokens (the sentinel
 * itself is tiny — ~20 tokens). The iteration then continues so that smaller
 * items after the oversize one can still land in the response.
 *
 * @param items       Results, pre-ranked (highest rank first).
 * @param maxTokens   User-facing `max_tokens` budget from the tool call.
 * @param serialize   How to turn one item into the text we'll count. Usually
 *                    `JSON.stringify`. Broken out so the caller can include
 *                    framing (commas, wrapping object keys) in the count.
 * @param idOf        Read the item's id for sentinel construction.
 * @param uriOf       Read the item's source uri for sentinel construction.
 */
export function fitResults<T>(
  items: T[],
  maxTokens: number,
  serialize: (item: T) => string,
  idOf: (item: T) => string,
  uriOf: (item: T) => string
): FitResult<T> {
  const budget = computeInternalBudget(maxTokens);
  const kept: Array<T | TooLargeSentinel> = [];
  let used = 0;
  let truncated = false;

  for (const item of items) {
    const serialized = serialize(item);
    const cost = countTokens(serialized);

    if (cost > budget) {
      // Single-oversize case — emit a sentinel so the caller can re-query.
      const sentinel: TooLargeSentinel = {
        too_large: true,
        id: idOf(item),
        source_uri: uriOf(item),
        tokens: cost,
      };
      const sentinelCost = countTokens(JSON.stringify(sentinel));
      if (used + sentinelCost > budget) {
        truncated = true;
        break;
      }
      kept.push(sentinel);
      used += sentinelCost;
      truncated = true; // we dropped the actual body
      continue;
    }

    if (used + cost > budget) {
      truncated = true;
      break;
    }

    kept.push(item);
    used += cost;
  }

  return {
    kept,
    truncated,
    tokensUsed: used,
    tokensBudgeted: budget,
  };
}

/**
 * Count tokens in an already-serialized response body without running the
 * fit loop. Used by the tool handlers to populate `meta.tokens_used` after
 * the envelope has been built.
 */
export function countEnvelopeTokens(envelopeJson: string): number {
  return countTokens(envelopeJson);
}
