import { describe, expect, it } from 'vitest';

import { TransformersEmbedder, EMBEDDING_DIM, CountingEmbedder } from '../../retrieval/embedder.js';

/**
 * Embedder smoke test for KG-MCP Phase 2.
 *
 * Verifies that `TransformersEmbedder.embed("hello world")` returns a
 * `Float32Array` of length 384 (the MiniLM output dim). Also exercises the
 * `CountingEmbedder` test wrapper to confirm it delegates correctly.
 *
 * **Note**: the first run downloads the MiniLM model (~25MB) into
 * `~/.cache/huggingface/`. Subsequent runs are offline. Test timeout is
 * generous (60s) to absorb the cold-start download; warm runs complete
 * in <2s.
 */
describe('retrieval/embedder (Phase 2)', () => {
  it(
    'TransformersEmbedder.embed("hello world") returns Float32Array(384)',
    async () => {
      const embedder = new TransformersEmbedder();
      await embedder.warmup();

      const vec = await embedder.embed('hello world');
      expect(vec).toBeInstanceOf(Float32Array);
      expect(vec.length).toBe(EMBEDDING_DIM);
      expect(vec.length).toBe(384);

      // Sanity: not all zeros (would indicate the model didn't actually run)
      const sumAbs = Array.from(vec).reduce((acc, v) => acc + Math.abs(v), 0);
      expect(sumAbs).toBeGreaterThan(0);

      // Sanity: L2-normalized (sum of squares ≈ 1.0)
      const sumSq = Array.from(vec).reduce((acc, v) => acc + v * v, 0);
      expect(sumSq).toBeCloseTo(1.0, 2);

      // CountingEmbedder wrapping the same instance: counter increments per call
      const counted = new CountingEmbedder(embedder);
      expect(counted.calls).toBe(0);
      expect(counted.dim).toBe(EMBEDDING_DIM);

      const vec2 = await counted.embed('hello again');
      expect(counted.calls).toBe(1);
      expect(vec2.length).toBe(384);

      await counted.embed('once more');
      expect(counted.calls).toBe(2);

      counted.reset();
      expect(counted.calls).toBe(0);
    },
    60_000 // 60s timeout for cold-start model download
  );
});
