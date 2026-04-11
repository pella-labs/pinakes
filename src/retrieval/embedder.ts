import { pipeline, env, type FeatureExtractionPipeline } from '@xenova/transformers';

import { logger } from '../observability/logger.js';

/**
 * Embedder interface + default `@xenova/transformers` MiniLM implementation.
 *
 * **Why this lives in `retrieval/`** (not `ingest/`): the embedder is shared
 * between the ingest path (computing chunk embeddings on insert) and the
 * future query path in Phase 4 (computing query embeddings for vector
 * search). Putting it under `retrieval/` keeps the code-mode bindings'
 * mental model consistent — `pinakes.vec()` and ingest both call into the same
 * factory.
 *
 * **Provider strategy** (CLAUDE.md §AI Rules #3): Phase 2 ships only the
 * bundled MiniLM provider. Phase 4 adds the env-driven factory:
 *   - `PINAKES_EMBED_PROVIDER=transformers` (default, this file)
 *   - `PINAKES_EMBED_PROVIDER=ollama` (HTTP, user-controlled)
 *   - `PINAKES_EMBED_PROVIDER=voyage` (HTTPS, paid)
 *   - `PINAKES_EMBED_PROVIDER=openai` (HTTPS, paid)
 *
 * **Failure mode** (CLAUDE.md §AI Rules #4): if the embedder fails during
 * ingest, the ingester logs a warning and inserts the node + chunks WITHOUT
 * vec rows. Query-time degrades gracefully to FTS5-only for affected chunks.
 * The contract here is that `embed()` may throw — callers must catch.
 *
 * **Singleton**: model load is ~25MB and takes ~800ms cold. We load once
 * per process via `getDefaultEmbedder()` and share the instance. The
 * `warmup()` method preloads the model proactively at server startup.
 */

/** Embedding output dimension for MiniLM. Locked — changing requires a vec table rebuild. */
export const EMBEDDING_DIM = 384;

/**
 * Generic embedder contract. Implementations: `TransformersEmbedder` (default),
 * `CountingEmbedder` (test wrapper), and Phase 4's `OllamaEmbedder` /
 * `VoyageEmbedder` / `OpenAIEmbedder`.
 */
export interface Embedder {
  /** Output dimension — load-bearing for the `pinakes_chunks_vec` schema */
  readonly dim: number;
  /** Eagerly load the underlying model. Optional — embed() will lazy-load on first call. */
  warmup(): Promise<void>;
  /** Embed a single text. Returns a Float32Array of length `dim`. */
  embed(text: string): Promise<Float32Array>;
}

// ----------------------------------------------------------------------------
// TransformersEmbedder — Xenova/all-MiniLM-L6-v2-quantized
// ----------------------------------------------------------------------------

const DEFAULT_MODEL = 'Xenova/all-MiniLM-L6-v2';

/**
 * MiniLM via @xenova/transformers, running locally in-process. No network
 * calls after first model download. The model is cached under
 * `~/.cache/huggingface/` (or `XENOVA_CACHE_DIR` if set) so subsequent
 * starts are fast (<500ms).
 *
 * Output: 384-dim Float32Array, mean-pooled across tokens, L2-normalized.
 * The `pooling: 'mean'` and `normalize: true` options match the upstream
 * Sentence Transformers reference inference, so embeddings produced here
 * are interchangeable with embeddings produced by the Python lib.
 */
export class TransformersEmbedder implements Embedder {
  readonly dim = EMBEDDING_DIM;

  private pipelinePromise: Promise<FeatureExtractionPipeline> | null = null;

  constructor(private readonly modelName: string = DEFAULT_MODEL) {
    // Allow Xenova to use local cache; only fall back to remote on first run.
    // Setting allowLocalModels=true is the default but explicit here for clarity.
    env.allowLocalModels = true;
    env.allowRemoteModels = true;
  }

  async warmup(): Promise<void> {
    await this.getPipeline();
  }

  async embed(text: string): Promise<Float32Array> {
    const extractor = await this.getPipeline();
    const tensor = await extractor(text, { pooling: 'mean', normalize: true });
    // Tensor.data is a Float32Array of shape [1, 384]; flatten to length 384.
    const data = tensor.data as Float32Array;
    if (data.length !== this.dim) {
      throw new Error(
        `embedder produced ${data.length}-dim vector but ${this.dim} was expected — wrong model loaded?`
      );
    }
    // Defensive copy: tensor.data may be reused on the next call.
    return new Float32Array(data);
  }

  private async getPipeline(): Promise<FeatureExtractionPipeline> {
    if (!this.pipelinePromise) {
      logger.info({ model: this.modelName }, 'loading transformers embedder');
      const t0 = Date.now();
      this.pipelinePromise = pipeline('feature-extraction', this.modelName, { quantized: true }) as Promise<
        FeatureExtractionPipeline
      >;
      this.pipelinePromise
        .then(() => {
          logger.info({ model: this.modelName, ms: Date.now() - t0 }, 'transformers embedder ready');
        })
        .catch((err: unknown) => {
          logger.error({ err, model: this.modelName }, 'transformers embedder failed to load');
          // Reset so subsequent calls can retry rather than reusing a rejected promise.
          this.pipelinePromise = null;
        });
    }
    return this.pipelinePromise;
  }
}

// ----------------------------------------------------------------------------
// CountingEmbedder — test wrapper used by the per-chunk skip-unchanged test
// ----------------------------------------------------------------------------

/**
 * Test-only wrapper that delegates to a real embedder and counts the number
 * of `embed()` calls. Used by `ingester.test.ts` to verify that re-ingesting
 * a file with one mutated paragraph triggers exactly one new embedder call —
 * the load-bearing per-chunk skip-unchanged optimization (Loop 6.5 A4).
 *
 * Lives next to the production embedder (not under `__tests__/`) so other
 * test files can import it without circular dep issues.
 */
export class CountingEmbedder implements Embedder {
  readonly dim: number;
  /** Number of times `embed()` has been called since construction (or `reset()`). */
  calls = 0;

  constructor(private readonly inner: Embedder) {
    this.dim = inner.dim;
  }

  async warmup(): Promise<void> {
    await this.inner.warmup();
  }

  async embed(text: string): Promise<Float32Array> {
    this.calls++;
    return this.inner.embed(text);
  }

  reset(): void {
    this.calls = 0;
  }
}

// ----------------------------------------------------------------------------
// OllamaEmbedder — HTTP to local Ollama instance
// ----------------------------------------------------------------------------

/**
 * Ollama embedder via HTTP POST to `/api/embeddings`.
 * Requires `PINAKES_OLLAMA_URL` and `PINAKES_OLLAMA_MODEL` env vars.
 */
export class OllamaEmbedder implements Embedder {
  readonly dim: number;

  constructor(
    private readonly baseUrl: string,
    private readonly model: string,
    dim: number = EMBEDDING_DIM
  ) {
    this.dim = dim;
  }

  async warmup(): Promise<void> {
    // Ollama loads the model on first request; nothing to pre-warm.
  }

  async embed(text: string): Promise<Float32Array> {
    const res = await fetch(`${this.baseUrl}/api/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: this.model, prompt: text }),
    });
    if (!res.ok) {
      throw new Error(`Ollama embed failed: ${res.status} ${res.statusText}`);
    }
    const json = (await res.json()) as { embedding: number[] };
    const vec = new Float32Array(json.embedding);
    if (vec.length !== this.dim) {
      throw new Error(
        `Ollama returned ${vec.length}-dim embedding but ${this.dim} expected`
      );
    }
    return vec;
  }
}

// ----------------------------------------------------------------------------
// VoyageEmbedder — HTTPS to Voyage AI
// ----------------------------------------------------------------------------

/**
 * Voyage AI embedder via HTTPS POST to `https://api.voyageai.com/v1/embeddings`.
 * Requires `PINAKES_VOYAGE_API_KEY` env var.
 */
export class VoyageEmbedder implements Embedder {
  readonly dim: number;

  constructor(
    private readonly apiKey: string,
    private readonly model: string = 'voyage-code-3',
    dim: number = EMBEDDING_DIM
  ) {
    this.dim = dim;
  }

  async warmup(): Promise<void> {}

  async embed(text: string): Promise<Float32Array> {
    const res = await fetch('https://api.voyageai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({ model: this.model, input: text }),
    });
    if (!res.ok) {
      throw new Error(`Voyage embed failed: ${res.status} ${res.statusText}`);
    }
    const json = (await res.json()) as { data: Array<{ embedding: number[] }> };
    const vec = new Float32Array(json.data[0].embedding);
    if (vec.length !== this.dim) {
      throw new Error(
        `Voyage returned ${vec.length}-dim embedding but ${this.dim} expected`
      );
    }
    return vec;
  }
}

// ----------------------------------------------------------------------------
// OpenAIEmbedder — HTTPS to OpenAI
// ----------------------------------------------------------------------------

/**
 * OpenAI embedder via HTTPS POST to `https://api.openai.com/v1/embeddings`.
 * Requires `PINAKES_OPENAI_API_KEY` env var.
 */
export class OpenAIEmbedder implements Embedder {
  readonly dim: number;

  constructor(
    private readonly apiKey: string,
    private readonly model: string = 'text-embedding-3-small',
    dim: number = EMBEDDING_DIM
  ) {
    this.dim = dim;
  }

  async warmup(): Promise<void> {}

  async embed(text: string): Promise<Float32Array> {
    const res = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({ model: this.model, input: text }),
    });
    if (!res.ok) {
      throw new Error(`OpenAI embed failed: ${res.status} ${res.statusText}`);
    }
    const json = (await res.json()) as { data: Array<{ embedding: number[] }> };
    const vec = new Float32Array(json.data[0].embedding);
    if (vec.length !== this.dim) {
      throw new Error(
        `OpenAI returned ${vec.length}-dim embedding but ${this.dim} expected`
      );
    }
    return vec;
  }
}

// ----------------------------------------------------------------------------
// Embedder factory
// ----------------------------------------------------------------------------

export type EmbedProvider = 'transformers' | 'ollama' | 'voyage' | 'openai';

/**
 * Create an embedder instance based on the provider name and environment.
 * Used at server startup. Falls back to TransformersEmbedder if the
 * provider is unrecognized.
 */
export function createEmbedder(provider?: EmbedProvider): Embedder {
  const p = provider ?? (process.env['PINAKES_EMBED_PROVIDER'] as EmbedProvider | undefined) ?? 'transformers';

  switch (p) {
    case 'ollama': {
      const url = process.env['PINAKES_OLLAMA_URL'] ?? 'http://localhost:11434';
      const model = process.env['PINAKES_OLLAMA_MODEL'] ?? 'nomic-embed-text';
      return new OllamaEmbedder(url, model);
    }
    case 'voyage': {
      const key = process.env['PINAKES_VOYAGE_API_KEY'];
      if (!key) throw new Error('PINAKES_VOYAGE_API_KEY is required for voyage embedder');
      const model = process.env['PINAKES_EMBED_MODEL'] ?? 'voyage-code-3';
      return new VoyageEmbedder(key, model);
    }
    case 'openai': {
      const key = process.env['PINAKES_OPENAI_API_KEY'];
      if (!key) throw new Error('PINAKES_OPENAI_API_KEY is required for openai embedder');
      const model = process.env['PINAKES_EMBED_MODEL'] ?? 'text-embedding-3-small';
      return new OpenAIEmbedder(key, model);
    }
    case 'transformers':
    default:
      return getDefaultEmbedder();
  }
}

// ----------------------------------------------------------------------------
// Default factory + singleton
// ----------------------------------------------------------------------------

let defaultEmbedder: TransformersEmbedder | null = null;

/**
 * Singleton accessor. Always returns the same `TransformersEmbedder` instance
 * within a process so the model loads exactly once. Tests that need a fresh
 * instance can construct `new TransformersEmbedder()` directly.
 */
export function getDefaultEmbedder(): TransformersEmbedder {
  if (!defaultEmbedder) {
    defaultEmbedder = new TransformersEmbedder();
  }
  return defaultEmbedder;
}
