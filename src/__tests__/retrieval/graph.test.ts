import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { closeDb, openDb, type DbBundle } from '../../db/client.js';
import { pagerank, connectedComponents } from '../../retrieval/graph.js';

/**
 * Graph algorithm tests (D40).
 *
 * Uses a real SQLite database with manually inserted nodes and edges
 * to test PageRank and connected components.
 */

interface TestContext {
  tmp: string;
  bundle: DbBundle;
}

describe('retrieval/graph (D40)', () => {
  let ctx: TestContext | null = null;

  beforeEach(() => {
    const tmp = mkdtempSync(join(tmpdir(), 'kg-graph-'));
    const bundle = openDb(join(tmp, 'kg.db'));
    ctx = { tmp, bundle };
  });

  afterEach(() => {
    if (ctx) {
      closeDb(ctx.bundle);
      rmSync(ctx.tmp, { recursive: true, force: true });
      ctx = null;
    }
  });

  function insertNode(id: string, sourceUri: string, title: string): void {
    const now = Date.now();
    ctx!.bundle.writer
      .prepare(
        `INSERT INTO kg_nodes (id, scope, source_uri, section_path, kind, title, content, source_sha, token_count, created_at, updated_at, last_accessed_at, confidence)
         VALUES (?, 'project', ?, '/', 'section', ?, '', 'sha', 0, ?, ?, ?, 'high')`
      )
      .run(id, sourceUri, title, now, now, now);
  }

  function insertEdge(srcId: string, dstId: string): void {
    ctx!.bundle.writer
      .prepare(`INSERT OR IGNORE INTO kg_edges (src_id, dst_id, edge_kind) VALUES (?, ?, 'wikilink')`)
      .run(srcId, dstId);
  }

  describe('pagerank', () => {
    it('returns empty array for no nodes', () => {
      const results = pagerank(ctx!.bundle.writer, 'project');
      expect(results).toEqual([]);
    });

    it('assigns equal scores to nodes in a cycle', () => {
      insertNode('a', 'a.md', 'Node A');
      insertNode('b', 'b.md', 'Node B');
      insertNode('c', 'c.md', 'Node C');
      insertEdge('a', 'b');
      insertEdge('b', 'c');
      insertEdge('c', 'a');

      const results = pagerank(ctx!.bundle.writer, 'project');
      expect(results.length).toBe(3);

      // All scores should be approximately equal (within floating point tolerance)
      const scores = results.map((r) => r.score);
      const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
      for (const score of scores) {
        expect(Math.abs(score - avg)).toBeLessThan(0.01);
      }
    });

    it('gives hub node the highest score', () => {
      // Star topology: A, B, C all point to Hub
      insertNode('hub', 'hub.md', 'Hub');
      insertNode('a', 'a.md', 'A');
      insertNode('b', 'b.md', 'B');
      insertNode('c', 'c.md', 'C');
      insertEdge('a', 'hub');
      insertEdge('b', 'hub');
      insertEdge('c', 'hub');

      const results = pagerank(ctx!.bundle.writer, 'project');
      expect(results[0].id).toBe('hub');
      expect(results[0].score).toBeGreaterThan(results[1].score);
    });

    it('assigns equal scores with no edges', () => {
      insertNode('a', 'a.md', 'A');
      insertNode('b', 'b.md', 'B');
      insertNode('c', 'c.md', 'C');

      const results = pagerank(ctx!.bundle.writer, 'project');
      expect(results.length).toBe(3);

      // With no edges + dangling redistribution, all should be ~1/N
      const scores = results.map((r) => r.score);
      for (const score of scores) {
        expect(Math.abs(score - 1 / 3)).toBeLessThan(0.01);
      }
    });

    it('respects limit option', () => {
      insertNode('a', 'a.md', 'A');
      insertNode('b', 'b.md', 'B');
      insertNode('c', 'c.md', 'C');

      const results = pagerank(ctx!.bundle.writer, 'project', { limit: 2 });
      expect(results.length).toBe(2);
    });
  });

  describe('connectedComponents', () => {
    it('returns empty array for no nodes', () => {
      const results = connectedComponents(ctx!.bundle.writer, 'project');
      expect(results).toEqual([]);
    });

    it('finds separate components', () => {
      // Component 1: A - B (linked)
      insertNode('a', 'a.md', 'A');
      insertNode('b', 'b.md', 'B');
      insertEdge('a', 'b');

      // Component 2: C (isolated)
      insertNode('c', 'c.md', 'C');

      const results = connectedComponents(ctx!.bundle.writer, 'project');
      expect(results.length).toBe(2);

      // Sorted by size descending
      expect(results[0].nodes.length).toBe(2); // A-B
      expect(results[1].nodes.length).toBe(1); // C
    });

    it('treats edges as undirected', () => {
      insertNode('a', 'a.md', 'A');
      insertNode('b', 'b.md', 'B');
      // Only A → B edge, but B should still be in same component as A
      insertEdge('a', 'b');

      const results = connectedComponents(ctx!.bundle.writer, 'project');
      expect(results.length).toBe(1);
      expect(results[0].nodes.length).toBe(2);
    });

    it('each isolated node is its own component', () => {
      insertNode('a', 'a.md', 'A');
      insertNode('b', 'b.md', 'B');
      insertNode('c', 'c.md', 'C');

      const results = connectedComponents(ctx!.bundle.writer, 'project');
      expect(results.length).toBe(3);
      for (const comp of results) {
        expect(comp.nodes.length).toBe(1);
      }
    });
  });
});
