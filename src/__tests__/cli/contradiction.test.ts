import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { closeDb, openDb, type DbBundle } from '../../db/client.js';
import {
  contradictionScan,
  parseContradictionResponse,
  deduplicateTopics,
  _groupByTopic,
  _cosineSimilarity,
} from '../../cli/contradiction.js';
import type { LlmProvider } from '../../llm/provider.js';
import type { Embedder } from '../../retrieval/embedder.js';

interface TestContext {
  tmp: string;
  wikiDir: string;
  bundle: DbBundle;
}

function mockLlmProvider(response: string): LlmProvider {
  return {
    name: 'mock',
    available: () => true,
    complete: vi.fn().mockResolvedValue(response),
  };
}

function seedClaims(
  bundle: DbBundle,
  scope: string,
  claims: Array<{ topic: string; claim: string; source_uri: string }>,
): void {
  const now = Date.now();
  // Ensure claims table exists (migrations run on openDb)
  const stmt = bundle.writer.prepare(
    `INSERT INTO pinakes_claims (scope, source_uri, topic, claim, extracted_at)
     VALUES (?, ?, ?, ?, ?)`,
  );
  for (const c of claims) {
    stmt.run(scope, c.source_uri, c.topic, c.claim, now);
  }
}

/** Mock embedder that returns a simple hash-based vector for testing dedup */
function mockEmbedder(dim = 8): Embedder {
  return {
    dim,
    warmup: async () => {},
    embed: async (text: string) => {
      // Simple deterministic embedding based on text content
      const vec = new Float32Array(dim);
      for (let i = 0; i < text.length; i++) {
        vec[i % dim]! += text.charCodeAt(i) / 1000;
      }
      // Normalize
      let norm = 0;
      for (let i = 0; i < dim; i++) norm += vec[i]! * vec[i]!;
      norm = Math.sqrt(norm);
      if (norm > 0) for (let i = 0; i < dim; i++) vec[i]! /= norm;
      return vec;
    },
  };
}

/** Mock embedder where specific strings map to specific vectors for controlled similarity */
function controlledEmbedder(mapping: Record<string, number[]>): Embedder {
  const dim = Object.values(mapping)[0]?.length ?? 8;
  return {
    dim,
    warmup: async () => {},
    embed: async (text: string) => {
      const vec = mapping[text.toLowerCase()];
      if (vec) return new Float32Array(vec);
      // Default: random-ish vector
      const result = new Float32Array(dim);
      for (let i = 0; i < text.length; i++) result[i % dim]! += text.charCodeAt(i) / 1000;
      let norm = 0;
      for (let i = 0; i < dim; i++) norm += result[i]! * result[i]!;
      norm = Math.sqrt(norm);
      if (norm > 0) for (let i = 0; i < dim; i++) result[i]! /= norm;
      return result;
    },
  };
}

describe('cli/contradiction v2 (Phase 9.3 D41)', () => {
  let ctx: TestContext | null = null;

  beforeEach(() => {
    const tmp = mkdtempSync(join(tmpdir(), 'pinakes-contradict-'));
    const wikiDir = join(tmp, 'wiki');
    mkdirSync(wikiDir, { recursive: true });
    const bundle = openDb(join(tmp, 'pinakes.db'));
    ctx = { tmp, wikiDir, bundle };
  });

  afterEach(() => {
    if (ctx) {
      closeDb(ctx.bundle);
      rmSync(ctx.tmp, { recursive: true, force: true });
      ctx = null;
    }
  });

  // --- Rate limiting ---

  it('rate limits to 1 scan per hour', async () => {
    const c = ctx!;
    c.bundle.writer
      .prepare(`INSERT INTO pinakes_meta (key, value) VALUES ('last_contradiction_scan', ?)`)
      .run(String(Date.now()));

    const result = await contradictionScan({
      bundle: c.bundle,
      scope: 'project',
      llmProvider: mockLlmProvider('{}'),
      wikiRoot: c.wikiDir,
    });

    expect(result.rate_limited).toBe(true);
    expect(result.scanned_pairs).toBe(0);
  });

  it('allows scan when last scan was > 1 hour ago', async () => {
    const c = ctx!;
    c.bundle.writer
      .prepare(`INSERT INTO pinakes_meta (key, value) VALUES ('last_contradiction_scan', ?)`)
      .run(String(Date.now() - 2 * 60 * 60 * 1000));

    const result = await contradictionScan({
      bundle: c.bundle,
      scope: 'project',
      llmProvider: mockLlmProvider('{}'),
      wikiRoot: c.wikiDir,
    });

    expect(result.rate_limited).toBe(false);
  });

  // --- Topic grouping ---

  it('groups claims by topic correctly', () => {
    const groups = _groupByTopic([
      { topic: 'auth', claim: 'uses OAuth2', source_uri: 'a.md' },
      { topic: 'auth', claim: 'JWT tokens', source_uri: 'b.md' },
      { topic: 'database', claim: 'PostgreSQL 15', source_uri: 'c.md' },
    ]);

    expect(groups).toHaveLength(2);
    const authGroup = groups.find((g) => g.topic === 'auth');
    expect(authGroup?.claims).toHaveLength(2);
  });

  it('skips single-file topic groups (no cross-file comparison)', async () => {
    const c = ctx!;
    // All claims from the same file
    seedClaims(c.bundle, 'project', [
      { topic: 'auth', claim: 'uses OAuth2', source_uri: 'auth.md' },
      { topic: 'auth', claim: 'JWT tokens expire after 1h', source_uri: 'auth.md' },
    ]);

    const provider = mockLlmProvider('{"contradictions":[]}');
    const result = await contradictionScan({
      bundle: c.bundle,
      scope: 'project',
      llmProvider: provider,
      wikiRoot: c.wikiDir,
    });

    // Should not call LLM for single-file topic
    expect(provider.complete).not.toHaveBeenCalled();
    expect(result.topics_scanned).toBe(0);
  });

  // --- Cross-file contradiction detection ---

  it('detects contradictions across files', async () => {
    const c = ctx!;
    seedClaims(c.bundle, 'project', [
      { topic: 'database', claim: 'Uses PostgreSQL 15', source_uri: 'setup.md' },
      { topic: 'database', claim: 'Uses PostgreSQL 14', source_uri: 'deploy.md' },
    ]);

    const provider = mockLlmProvider(JSON.stringify({
      contradictions: [{
        claim_a: 'Uses PostgreSQL 15',
        source_a: 'setup.md',
        claim_b: 'Uses PostgreSQL 14',
        source_b: 'deploy.md',
        explanation: 'Different PostgreSQL versions specified',
        confidence: 'high',
      }],
    }));

    const result = await contradictionScan({
      bundle: c.bundle,
      scope: 'project',
      llmProvider: provider,
      wikiRoot: c.wikiDir,
    });

    expect(result.contradictions).toHaveLength(1);
    expect(result.contradictions[0]!.topic).toBe('database');
    expect(result.contradictions[0]!.explanation).toContain('PostgreSQL');
  });

  it('contradiction includes topic name for context', async () => {
    const c = ctx!;
    seedClaims(c.bundle, 'project', [
      { topic: 'authentication', claim: 'OAuth2 required', source_uri: 'a.md' },
      { topic: 'authentication', claim: 'Basic auth only', source_uri: 'b.md' },
    ]);

    const provider = mockLlmProvider(JSON.stringify({
      contradictions: [{
        claim_a: 'OAuth2 required',
        source_a: 'a.md',
        claim_b: 'Basic auth only',
        source_b: 'b.md',
        explanation: 'Conflicting auth requirements',
        confidence: 'high',
      }],
    }));

    const result = await contradictionScan({
      bundle: c.bundle,
      scope: 'project',
      llmProvider: provider,
      wikiRoot: c.wikiDir,
    });

    expect(result.contradictions[0]!.topic).toBe('authentication');
  });

  // --- Topic dedup ---

  it('merges highly similar topics via embeddings', async () => {
    // Two nearly identical vectors for "oauth2" and "oauth 2.0"
    const embedder = controlledEmbedder({
      'oauth2': [0.9, 0.1, 0.0, 0.0],
      'oauth 2.0': [0.89, 0.12, 0.01, 0.0],  // very similar
      'database': [0.0, 0.0, 0.9, 0.1],        // very different
    });

    const groups = [
      { topic: 'oauth2', claims: [{ claim: 'c1', source_uri: 'a.md' }] },
      { topic: 'oauth 2.0', claims: [{ claim: 'c2', source_uri: 'b.md' }] },
      { topic: 'database', claims: [{ claim: 'c3', source_uri: 'c.md' }] },
    ];

    const result = await deduplicateTopics(groups, embedder, 0.85);
    // oauth2 + oauth 2.0 should merge, database stays separate
    expect(result).toHaveLength(2);
    const oauthGroup = result.find((g) => g.claims.length === 2);
    expect(oauthGroup).toBeDefined();
    expect(oauthGroup!.claims).toHaveLength(2);
  });

  it('does NOT merge distinct topics', async () => {
    const embedder = controlledEmbedder({
      'authentication': [0.9, 0.1, 0.0, 0.0],
      'authorization': [0.0, 0.0, 0.9, 0.1],  // very different
    });

    const groups = [
      { topic: 'authentication', claims: [{ claim: 'c1', source_uri: 'a.md' }] },
      { topic: 'authorization', claims: [{ claim: 'c2', source_uri: 'b.md' }] },
    ];

    const result = await deduplicateTopics(groups, embedder, 0.85);
    expect(result).toHaveLength(2);
  });

  // --- Response parsing ---

  it('parses valid contradiction response', () => {
    const result = parseContradictionResponse(JSON.stringify({
      contradictions: [{
        claim_a: 'A', source_a: 'a.md',
        claim_b: 'B', source_b: 'b.md',
        explanation: 'conflict', confidence: 'high',
      }],
    }));
    expect(result).toHaveLength(1);
    expect(result[0]!.explanation).toBe('conflict');
  });

  it('returns empty array for no-contradiction response', () => {
    expect(parseContradictionResponse('{"contradictions":[]}')).toEqual([]);
  });

  it('handles malformed response', () => {
    expect(parseContradictionResponse('not json')).toEqual([]);
    expect(parseContradictionResponse('{"contradictions": "bad"}')).toEqual([]);
  });

  it('filters out low-confidence contradictions', () => {
    const result = parseContradictionResponse(JSON.stringify({
      contradictions: [
        { claim_a: 'A', source_a: 'a', claim_b: 'B', source_b: 'b', explanation: 'x', confidence: 'low' },
        { claim_a: 'C', source_a: 'c', claim_b: 'D', source_b: 'd', explanation: 'y', confidence: 'high' },
      ],
    }));
    expect(result).toHaveLength(1);
    expect(result[0]!.confidence).toBe('high');
  });

  // --- Progress ---

  it('reports progress per topic group', async () => {
    const c = ctx!;
    seedClaims(c.bundle, 'project', [
      { topic: 'auth', claim: 'OAuth2', source_uri: 'a.md' },
      { topic: 'auth', claim: 'basic', source_uri: 'b.md' },
    ]);

    const ticks: string[] = [];
    const progress = {
      startPhase: vi.fn(),
      tick: vi.fn((label: string) => ticks.push(label)),
      endPhase: vi.fn(),
    };

    await contradictionScan({
      bundle: c.bundle,
      scope: 'project',
      llmProvider: mockLlmProvider('{"contradictions":[]}'),
      wikiRoot: c.wikiDir,
      progress,
    });

    expect(progress.startPhase).toHaveBeenCalled();
    expect(ticks).toContain('auth');
    expect(progress.endPhase).toHaveBeenCalled();
  });
});
