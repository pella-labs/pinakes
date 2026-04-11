import type { Database as BetterSqliteDatabase } from 'better-sqlite3';

/**
 * Graph algorithms over the `kg_edges` table (D40).
 *
 * - **PageRank**: iterative power method (d=0.85, 20 iterations).
 * - **Connected components**: BFS on undirected edge interpretation.
 *
 * Both implementations are pure JS over SQL-loaded adjacency data.
 * No new dependencies.
 */

// ---------------------------------------------------------------------------
// PageRank
// ---------------------------------------------------------------------------

export interface PageRankOpts {
  /** Damping factor (default 0.85). */
  damping?: number;
  /** Number of iterations (default 20, max 100). */
  iterations?: number;
  /** Max results to return (default 20, max 100). */
  limit?: number;
}

export interface PageRankResult {
  id: string;
  source_uri: string;
  title: string | null;
  score: number;
}

/**
 * Compute PageRank over the knowledge graph for a given scope.
 *
 * Uses the iterative power method:
 *   PR(v) = (1-d)/N + d * Σ PR(u)/out(u) for u in in-neighbors(v)
 *
 * Dangling nodes (no outgoing edges) redistribute their rank evenly.
 */
export function pagerank(
  reader: BetterSqliteDatabase,
  scope: string,
  opts?: PageRankOpts
): PageRankResult[] {
  const d = opts?.damping ?? 0.85;
  const iterations = Math.min(Math.max(opts?.iterations ?? 20, 1), 100);
  const limit = Math.min(Math.max(opts?.limit ?? 20, 1), 100);

  // Load all nodes
  const nodes = reader
    .prepare<[string], { id: string; source_uri: string; title: string | null }>(
      `SELECT id, source_uri, title FROM kg_nodes WHERE scope = ?`
    )
    .all(scope);

  if (nodes.length === 0) return [];

  const N = nodes.length;
  const nodeSet = new Set(nodes.map((n) => n.id));

  // Load edges (only between nodes in this scope)
  const edges = reader
    .prepare<[string, string], { src_id: string; dst_id: string }>(
      `SELECT e.src_id, e.dst_id FROM kg_edges e
       JOIN kg_nodes ns ON e.src_id = ns.id
       JOIN kg_nodes nd ON e.dst_id = nd.id
       WHERE ns.scope = ? AND nd.scope = ?`
    )
    .all(scope, scope);

  // Build adjacency: outgoing edges and incoming edges
  const outDegree = new Map<string, number>();
  const inEdges = new Map<string, string[]>();

  for (const nodeId of nodeSet) {
    outDegree.set(nodeId, 0);
    inEdges.set(nodeId, []);
  }

  for (const e of edges) {
    if (!nodeSet.has(e.src_id) || !nodeSet.has(e.dst_id)) continue;
    outDegree.set(e.src_id, (outDegree.get(e.src_id) ?? 0) + 1);
    inEdges.get(e.dst_id)!.push(e.src_id);
  }

  // Initialize ranks
  let ranks = new Map<string, number>();
  for (const nodeId of nodeSet) {
    ranks.set(nodeId, 1 / N);
  }

  // Iterate
  for (let iter = 0; iter < iterations; iter++) {
    const newRanks = new Map<string, number>();

    // Collect dangling node rank sum
    let danglingSum = 0;
    for (const nodeId of nodeSet) {
      if ((outDegree.get(nodeId) ?? 0) === 0) {
        danglingSum += ranks.get(nodeId)!;
      }
    }

    for (const nodeId of nodeSet) {
      let inSum = 0;
      for (const src of inEdges.get(nodeId)!) {
        inSum += ranks.get(src)! / (outDegree.get(src) ?? 1);
      }
      // Add dangling redistribution
      const pr = (1 - d) / N + d * (inSum + danglingSum / N);
      newRanks.set(nodeId, pr);
    }

    ranks = newRanks;
  }

  // Build results, sort by descending score
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const results: PageRankResult[] = [];

  for (const [id, score] of ranks) {
    const node = nodeMap.get(id);
    if (node) {
      results.push({
        id: node.id,
        source_uri: node.source_uri,
        title: node.title,
        score,
      });
    }
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, limit);
}

// ---------------------------------------------------------------------------
// Connected Components
// ---------------------------------------------------------------------------

export interface ComponentResult {
  component_id: number;
  nodes: Array<{ id: string; source_uri: string; title: string | null }>;
}

/**
 * Find connected components in the knowledge graph (undirected).
 * Returns components sorted by size descending.
 */
export function connectedComponents(
  reader: BetterSqliteDatabase,
  scope: string
): ComponentResult[] {
  // Load all nodes
  const nodes = reader
    .prepare<[string], { id: string; source_uri: string; title: string | null }>(
      `SELECT id, source_uri, title FROM kg_nodes WHERE scope = ?`
    )
    .all(scope);

  if (nodes.length === 0) return [];

  // Load edges (undirected: add both directions)
  const edges = reader
    .prepare<[string, string], { src_id: string; dst_id: string }>(
      `SELECT e.src_id, e.dst_id FROM kg_edges e
       JOIN kg_nodes ns ON e.src_id = ns.id
       JOIN kg_nodes nd ON e.dst_id = nd.id
       WHERE ns.scope = ? AND nd.scope = ?`
    )
    .all(scope, scope);

  // Build undirected adjacency list
  const adj = new Map<string, Set<string>>();
  for (const n of nodes) {
    adj.set(n.id, new Set());
  }
  for (const e of edges) {
    adj.get(e.src_id)?.add(e.dst_id);
    adj.get(e.dst_id)?.add(e.src_id);
  }

  // BFS to find components
  const visited = new Set<string>();
  const components: ComponentResult[] = [];
  let componentId = 0;

  for (const node of nodes) {
    if (visited.has(node.id)) continue;

    const component: string[] = [];
    const queue = [node.id];
    visited.add(node.id);

    while (queue.length > 0) {
      const current = queue.shift()!;
      component.push(current);

      for (const neighbor of adj.get(current) ?? []) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          queue.push(neighbor);
        }
      }
    }

    const nodeMap = new Map(nodes.map((n) => [n.id, n]));
    components.push({
      component_id: componentId++,
      nodes: component.map((id) => {
        const n = nodeMap.get(id)!;
        return { id: n.id, source_uri: n.source_uri, title: n.title };
      }),
    });
  }

  // Sort by component size descending
  components.sort((a, b) => b.nodes.length - a.nodes.length);
  return components;
}
