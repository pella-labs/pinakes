import type { HybridResult } from './hybrid.js';

/**
 * Post-RRF dedup pipeline (D37, GBrain-inspired).
 *
 * Three layers, applied in order after RRF fusion:
 *
 * 1. **Source-URI cap (max 3)**: no single wiki page dominates results.
 * 2. **Jaccard bigram similarity (>0.85)**: drop near-duplicate text
 *    regardless of which file it came from.
 * 3. **Final source-URI cap (max 2)**: tighter diversity after dedup.
 *
 * The input must already be sorted by descending RRF score (which
 * `rrfFuse` guarantees). The output preserves that ordering.
 */

/**
 * Deduplicate hybrid search results. Input MUST be sorted by descending
 * RRF score. Returns a new array (does not mutate the input).
 */
export function dedupResults(results: HybridResult[]): HybridResult[] {
  // Layer 1: max 3 chunks per source_uri
  let kept = capPerSourceUri(results, 3);

  // Layer 2: Jaccard bigram similarity > 0.85 against already-kept
  kept = jaccardDedup(kept, 0.85);

  // Layer 3: final cap at 2 per source_uri
  kept = capPerSourceUri(kept, 2);

  return kept;
}

// ---------------------------------------------------------------------------
// Layer 1 & 3: cap per source_uri
// ---------------------------------------------------------------------------

function capPerSourceUri(results: HybridResult[], maxPerUri: number): HybridResult[] {
  const counts = new Map<string, number>();
  const out: HybridResult[] = [];

  for (const r of results) {
    const count = counts.get(r.source_uri) ?? 0;
    if (count >= maxPerUri) continue;
    counts.set(r.source_uri, count + 1);
    out.push(r);
  }

  return out;
}

// ---------------------------------------------------------------------------
// Layer 2: Jaccard bigram similarity
// ---------------------------------------------------------------------------

/**
 * Remove results whose text is too similar (Jaccard > threshold) to a
 * higher-ranked result already in the kept set. Preserves rank order.
 */
function jaccardDedup(results: HybridResult[], threshold: number): HybridResult[] {
  const kept: HybridResult[] = [];
  const keptBigrams: Set<string>[] = [];

  for (const r of results) {
    const bigrams = toBigrams(r.text);
    let duplicate = false;

    for (const existingBigrams of keptBigrams) {
      if (jaccardSimilarity(bigrams, existingBigrams) > threshold) {
        duplicate = true;
        break;
      }
    }

    if (!duplicate) {
      kept.push(r);
      keptBigrams.push(bigrams);
    }
  }

  return kept;
}

/** Split text into a set of whitespace-separated bigrams. */
function toBigrams(text: string): Set<string> {
  const words = text.toLowerCase().split(/\s+/).filter(Boolean);
  const bigrams = new Set<string>();
  for (let i = 0; i < words.length - 1; i++) {
    bigrams.add(`${words[i]} ${words[i + 1]}`);
  }
  // Single-word texts: use the word itself as the "bigram"
  if (bigrams.size === 0 && words.length > 0) {
    bigrams.add(words[0]);
  }
  return bigrams;
}

/** |A ∩ B| / |A ∪ B| — classic Jaccard index. */
function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let intersection = 0;
  const smaller = a.size <= b.size ? a : b;
  const larger = a.size <= b.size ? b : a;
  for (const item of smaller) {
    if (larger.has(item)) intersection++;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 1 : intersection / union;
}

// Re-export for testing
export { toBigrams as _toBigrams, jaccardSimilarity as _jaccardSimilarity };
