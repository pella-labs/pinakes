import type { Database as BetterSqliteDatabase } from 'better-sqlite3';

import type { Embedder } from './embedder.js';
import { dedupResults } from './dedup.js';
import { ftsQuery, type FtsResult } from './fts.js';
import { vecSearch, type VecResult } from './vec.js';

/**
 * Hybrid retrieval: FTS5 + sqlite-vec fused via Reciprocal Rank Fusion (RRF).
 *
 * This is the canonical Alex Garcia pattern from presearch.md:
 *   RRF_score(d) = Σ 1 / (rrf_k + rank_i(d))
 *
 * where rank_i(d) is the 1-based rank of document d in result list i.
 *
 * Items appearing in only one list get a single-side RRF score (the other
 * term is zero). Items in both lists get both terms summed.
 *
 * Phase 7.5: equal-weight RRF (no adaptive weighting). The LLM is the
 * precision layer; we optimize for recall by letting both FTS and vec
 * contribute equally. FTS catches keyword matches vec might miss; vec
 * catches semantic matches FTS misses.
 *
 * Default `rrf_k = 60` per the PRD.
 */

const DEFAULT_RRF_K = 60;

export interface HybridResult {
  id: string;
  text: string;
  source_uri: string;
  node_id: string;
  score: number;
  snippet?: string;
  confidence: string;
  title: string | null;
  section_path: string;
  effective_confidence?: number;
}

export interface HybridSearchOpts {
  limit?: number;
  rrf_k?: number;
  /** Set to false to disable post-RRF dedup (default: true). */
  dedup?: boolean;
}

/**
 * Run a hybrid FTS5 + vector search with RRF fusion.
 *
 * Both sub-queries run with an over-fetch factor (2x limit) so that RRF
 * has enough candidates to fuse meaningfully.
 *
 * @param reader    Read-only DB connection.
 * @param scope     `'project'` or `'personal'`.
 * @param query     Raw query text.
 * @param embedder  Embedder for the vector path.
 * @param opts      `limit` (default 20), `rrf_k` (default 60).
 * @returns         Results sorted by descending RRF score.
 */
export async function hybridSearch(
  reader: BetterSqliteDatabase,
  scope: string,
  query: string,
  embedder: Embedder,
  opts?: HybridSearchOpts
): Promise<HybridResult[]> {
  const limit = Math.min(Math.max(opts?.limit ?? 20, 1), 100);
  const rrfK = opts?.rrf_k ?? DEFAULT_RRF_K;
  const shouldDedup = opts?.dedup !== false;

  // Over-fetch from each source so RRF has good coverage.
  // When dedup is on, fetch extra since dedup will remove some results.
  const dedupOverfetch = shouldDedup ? 3 : 2;
  const fetchLimit = Math.min(limit * dedupOverfetch, 100);

  // Run both queries. Vec is async (embedding), FTS is sync.
  const [ftsResults, vecResults] = await Promise.all([
    Promise.resolve(ftsQuery(reader, scope, query, fetchLimit)),
    vecSearch(reader, scope, query, embedder, fetchLimit),
  ]);

  const fused = rrfFuse(ftsResults, vecResults, rrfK, shouldDedup ? limit * 2 : limit);

  if (!shouldDedup) return fused;
  return dedupResults(fused).slice(0, limit);
}

/**
 * Fuse FTS and vec results via equal-weight Reciprocal Rank Fusion.
 *
 * Phase 7.5: equal weighting — both FTS and vec contribute `1/(rrfK+rank)`.
 * No adaptive weighting or BM25 filtering. The LLM is the precision layer.
 *
 * Exported for direct testing — `hybridSearch` is the normal entry point.
 */
export function rrfFuse(
  ftsResults: FtsResult[],
  vecResults: VecResult[],
  rrfK: number,
  limit: number
): HybridResult[] {
  // Build a map keyed by chunk id. Each entry accumulates its RRF score.
  const merged = new Map<string, HybridResult & { _rrfScore: number }>();

  // FTS: rank is 1-based position in the result list.
  for (let i = 0; i < ftsResults.length; i++) {
    const r = ftsResults[i];
    const rrfScore = 1 / (rrfK + (i + 1));
    const existing = merged.get(r.id);
    if (existing) {
      existing._rrfScore += rrfScore;
      // Prefer FTS snippet over vec (which has none).
      if (r.snippet) existing.snippet = r.snippet;
    } else {
      merged.set(r.id, {
        id: r.id,
        text: r.text,
        source_uri: r.source_uri,
        node_id: r.node_id,
        score: 0, // filled after fusion
        snippet: r.snippet || undefined,
        confidence: r.confidence,
        title: r.title ?? null,
        section_path: r.section_path ?? '',
        effective_confidence: r.effective_confidence,
        _rrfScore: rrfScore,
      });
    }
  }

  // Vec: rank is 1-based position in the vec result list.
  for (let i = 0; i < vecResults.length; i++) {
    const r = vecResults[i];
    const rrfScore = 1 / (rrfK + (i + 1));
    const existing = merged.get(r.id);
    if (existing) {
      existing._rrfScore += rrfScore;
    } else {
      merged.set(r.id, {
        id: r.id,
        text: r.text,
        source_uri: r.source_uri,
        node_id: r.node_id,
        score: 0,
        confidence: r.confidence,
        title: r.title ?? null,
        section_path: r.section_path ?? '',
        effective_confidence: r.effective_confidence,
        _rrfScore: rrfScore,
      });
    }
  }

  // Sort by descending RRF score, assign final score, trim to limit.
  const sorted = [...merged.values()].sort((a, b) => b._rrfScore - a._rrfScore);

  return sorted.slice(0, limit).map((r) => ({
    id: r.id,
    text: r.text,
    source_uri: r.source_uri,
    node_id: r.node_id,
    score: r._rrfScore,
    snippet: r.snippet,
    confidence: r.confidence,
    title: r.title,
    section_path: r.section_path,
    effective_confidence: r.effective_confidence,
  }));
}

/**
 * Fuse N lists of HybridResult via RRF (D38, multi-query expansion).
 *
 * Generalizes the 2-list `rrfFuse` to arbitrary N lists. Each list
 * assigns 1-based ranks; scores accumulate across all lists a result
 * appears in.
 */
export function rrfFuseMulti(
  lists: HybridResult[][],
  rrfK: number,
  limit: number
): HybridResult[] {
  const merged = new Map<string, HybridResult & { _rrfScore: number }>();

  for (const list of lists) {
    for (let i = 0; i < list.length; i++) {
      const r = list[i];
      const rrfScore = 1 / (rrfK + (i + 1));
      const existing = merged.get(r.id);
      if (existing) {
        existing._rrfScore += rrfScore;
        if (r.snippet && !existing.snippet) existing.snippet = r.snippet;
      } else {
        merged.set(r.id, {
          id: r.id,
          text: r.text,
          source_uri: r.source_uri,
          node_id: r.node_id,
          score: 0,
          snippet: r.snippet,
          confidence: r.confidence,
          title: r.title ?? null,
          section_path: r.section_path ?? '',
          effective_confidence: r.effective_confidence,
          _rrfScore: rrfScore,
        });
      }
    }
  }

  const sorted = [...merged.values()].sort((a, b) => b._rrfScore - a._rrfScore);

  return sorted.slice(0, limit).map((r) => ({
    id: r.id,
    text: r.text,
    source_uri: r.source_uri,
    node_id: r.node_id,
    score: r._rrfScore,
    snippet: r.snippet,
    confidence: r.confidence,
    title: r.title,
    section_path: r.section_path,
    effective_confidence: r.effective_confidence,
  }));
}
