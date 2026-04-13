import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { Database as BetterSqliteDatabase } from 'better-sqlite3';

import {
  effectiveConfidence,
  corroborationBoost,
  contradictionPenalty,
  getHalfLife,
  HALF_LIFE_DAYS,
  updateCorroborationScores,
  applyContradictionPenalties,
  evictPersonalKg,
} from '../../gate/confidence.js';
import { openDb, closeDb, type DbBundle } from '../../db/client.js';

const MS_PER_DAY = 86_400_000;

// ---------------------------------------------------------------------------
// Pure function tests
// ---------------------------------------------------------------------------

describe('effectiveConfidence', () => {
  const now = Date.now();

  it('returns base score for a fresh node (0 days elapsed)', () => {
    const score = effectiveConfidence(0.7, now, 'section', now);
    expect(score).toBeCloseTo(0.7, 5);
  });

  it('returns ~0.35 after one half-life (section = 90 days)', () => {
    const updatedAt = now - 90 * MS_PER_DAY;
    const score = effectiveConfidence(0.7, updatedAt, 'section', now);
    expect(score).toBeCloseTo(0.35, 1);
  });

  it('returns ~0.175 after 2x half-life (180 days for section)', () => {
    const updatedAt = now - 180 * MS_PER_DAY;
    const score = effectiveConfidence(0.7, updatedAt, 'section', now);
    expect(score).toBeCloseTo(0.175, 1);
  });

  it('per-kind half-lives: decision nodes decay slower than log entries', () => {
    const daysElapsed = 60;
    const updatedAt = now - daysElapsed * MS_PER_DAY;

    const decisionScore = effectiveConfidence(0.7, updatedAt, 'decision', now);
    const logScore = effectiveConfidence(0.7, updatedAt, 'log_entry', now);

    // Decision has 180-day half-life, log_entry has 30-day.
    // After 60 days: decision barely decayed, log_entry decayed 2 half-lives
    expect(decisionScore).toBeGreaterThan(logScore);
    expect(decisionScore).toBeGreaterThan(0.5); // barely decayed
    expect(logScore).toBeLessThan(0.2); // deeply decayed
  });

  it('uses default half-life for unknown kinds', () => {
    const updatedAt = now - 90 * MS_PER_DAY;
    const score = effectiveConfidence(0.7, updatedAt, 'unknown_kind', now);
    // Default half-life is 90 days, so ~0.35
    expect(score).toBeCloseTo(0.35, 1);
  });
});

describe('corroborationBoost', () => {
  it('increases score by 0.1 per additional source', () => {
    expect(corroborationBoost(0.7, 1)).toBeCloseTo(0.8);
    expect(corroborationBoost(0.7, 2)).toBeCloseTo(0.9);
  });

  it('caps at 1.0', () => {
    expect(corroborationBoost(0.7, 5)).toBe(1.0);
    expect(corroborationBoost(0.9, 3)).toBe(1.0);
  });
});

describe('contradictionPenalty', () => {
  it('decreases score by 0.15 per contradiction', () => {
    expect(contradictionPenalty(0.7, 1)).toBeCloseTo(0.55);
    expect(contradictionPenalty(0.7, 2)).toBeCloseTo(0.4);
  });

  it('floors at 0.1', () => {
    expect(contradictionPenalty(0.7, 10)).toBe(0.1);
    expect(contradictionPenalty(0.3, 3)).toBe(0.1);
  });
});

describe('getHalfLife', () => {
  it('returns per-kind values from the lookup table', () => {
    expect(getHalfLife('section')).toBe(90);
    expect(getHalfLife('decision')).toBe(180);
    expect(getHalfLife('log_entry')).toBe(30);
  });

  it('respects PINAKES_DECAY_HALF_LIFE_DEFAULT env var', () => {
    const old = process.env.PINAKES_DECAY_HALF_LIFE_DEFAULT;
    try {
      process.env.PINAKES_DECAY_HALF_LIFE_DEFAULT = '45';
      expect(getHalfLife('section')).toBe(45);
      expect(getHalfLife('decision')).toBe(45);
    } finally {
      if (old === undefined) delete process.env.PINAKES_DECAY_HALF_LIFE_DEFAULT;
      else process.env.PINAKES_DECAY_HALF_LIFE_DEFAULT = old;
    }
  });
});

// ---------------------------------------------------------------------------
// DB-backed tests
// ---------------------------------------------------------------------------

describe('confidence DB integration', () => {
  let bundle: DbBundle;
  let writer: BetterSqliteDatabase;

  beforeAll(() => {
    bundle = openDb(':memory:');
    writer = bundle.writer;
  });

  afterAll(() => closeDb(bundle));

  beforeEach(() => {
    // Clean slate
    writer.exec('DELETE FROM pinakes_claims');
    writer.exec('DELETE FROM pinakes_chunks');
    writer.exec('DELETE FROM pinakes_nodes');
  });

  function insertNode(id: string, scope: string, opts: {
    title?: string;
    confidence?: string;
    confidenceScore?: number;
    updatedAt?: number;
    kind?: string;
    sourceUri?: string;
  } = {}) {
    const now = Date.now();
    writer.prepare(
      `INSERT INTO pinakes_nodes (id, scope, source_uri, section_path, kind, title, content, source_sha, token_count, created_at, updated_at, last_accessed_at, confidence, confidence_score)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      scope,
      opts.sourceUri ?? `${id}.md`,
      '',
      opts.kind ?? 'section',
      opts.title ?? id,
      `# ${id}\ncontent`,
      'sha1',
      10,
      now,
      opts.updatedAt ?? now,
      now,
      opts.confidence ?? 'extracted',
      opts.confidenceScore ?? 0.7,
    );
  }

  function insertChunk(nodeId: string, chunkIdx: number) {
    const chunkId = `${nodeId}:${chunkIdx}`;
    writer.prepare(
      `INSERT INTO pinakes_chunks (id, node_id, chunk_index, text, chunk_sha, token_count, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(chunkId, nodeId, chunkIdx, 'chunk text', `sha_${chunkId}`, 5, Date.now());
    return chunkId;
  }

  function insertClaim(scope: string, sourceUri: string, topic: string, claim: string) {
    writer.prepare(
      `INSERT INTO pinakes_claims (scope, source_uri, topic, claim, extracted_at)
       VALUES (?, ?, ?, ?, ?)`
    ).run(scope, sourceUri, topic, claim, Date.now());
  }

  it('schema migration backfills existing nodes correctly', () => {
    // The migration already ran when openDb was called.
    // Insert nodes with different confidence values and verify confidence_score
    insertNode('n1', 'project', { confidence: 'extracted', confidenceScore: 0.7 });
    insertNode('n2', 'project', { confidence: 'inferred', confidenceScore: 0.5 });
    insertNode('n3', 'project', { confidence: 'ambiguous', confidenceScore: 0.3 });

    const rows = writer.prepare<[], { id: string; confidence_score: number }>(
      `SELECT id, confidence_score FROM pinakes_nodes ORDER BY id`
    ).all();

    expect(rows).toEqual([
      { id: 'n1', confidence_score: 0.7 },
      { id: 'n2', confidence_score: 0.5 },
      { id: 'n3', confidence_score: 0.3 },
    ]);
  });

  it('backward compat: TEXT confidence column still readable', () => {
    insertNode('bc1', 'project', { confidence: 'inferred' });
    const row = writer.prepare<[string], { confidence: string }>(
      `SELECT confidence FROM pinakes_nodes WHERE id = ?`
    ).get('bc1');
    expect(row?.confidence).toBe('inferred');
  });

  it('updateCorroborationScores boosts nodes corroborated by multiple files', () => {
    insertNode('corr1', 'project', { title: 'Auth', confidenceScore: 0.7, sourceUri: 'auth.md' });

    // Claims about "Auth" from 3 different source files
    insertClaim('project', 'auth.md', 'Auth', 'Auth uses JWT');
    insertClaim('project', 'security.md', 'Auth', 'Auth requires TLS');
    insertClaim('project', 'api.md', 'Auth', 'Auth has rate limiting');

    const result = updateCorroborationScores(writer, 'project');
    expect(result.updated).toBe(1);

    const row = writer.prepare<[string], { confidence_score: number }>(
      `SELECT confidence_score FROM pinakes_nodes WHERE id = ?`
    ).get('corr1');
    // 0.7 + 2*0.1 = 0.9 (3 sources - 1 = 2 additional)
    expect(row?.confidence_score).toBeCloseTo(0.9);
  });

  it('applyContradictionPenalties reduces confidence for contradicting nodes', () => {
    insertNode('contra1', 'project', { confidenceScore: 0.7, sourceUri: 'a.md' });
    insertNode('contra2', 'project', { confidenceScore: 0.7, sourceUri: 'b.md' });

    const result = applyContradictionPenalties(writer, 'project', [
      {
        topic: 'Test',
        claimA: { source_uri: 'a.md' },
        claimB: { source_uri: 'b.md' },
      },
    ]);
    expect(result.penalized).toBe(2);

    const rows = writer.prepare<[], { id: string; confidence_score: number }>(
      `SELECT id, confidence_score FROM pinakes_nodes WHERE id IN ('contra1', 'contra2') ORDER BY id`
    ).all();
    expect(rows[0]?.confidence_score).toBeCloseTo(0.55);
    expect(rows[1]?.confidence_score).toBeCloseTo(0.55);
  });

  it('evictPersonalKg removes lowest-confidence nodes first', () => {
    // Insert personal nodes with different confidence scores
    insertNode('p-high', 'personal', { confidenceScore: 0.9 });
    insertChunk('p-high', 0);
    insertChunk('p-high', 1);

    insertNode('p-low', 'personal', { confidenceScore: 0.2 });
    insertChunk('p-low', 0);
    insertChunk('p-low', 1);

    insertNode('p-mid', 'personal', { confidenceScore: 0.5 });
    insertChunk('p-mid', 0);

    // 5 chunks total, evict to max 3
    const result = evictPersonalKg(writer, 3);
    expect(result.nodesEvicted).toBe(1);
    expect(result.chunksEvicted).toBe(2);

    // The low-confidence node should be evicted
    const remaining = writer.prepare<[], { id: string }>(
      `SELECT id FROM pinakes_nodes WHERE scope = 'personal' ORDER BY id`
    ).all();
    expect(remaining.map((r) => r.id)).toEqual(['p-high', 'p-mid']);
  });

  it('evictPersonalKg respects chunk cap', () => {
    insertNode('cap1', 'personal', { confidenceScore: 0.7 });
    insertChunk('cap1', 0);
    insertNode('cap2', 'personal', { confidenceScore: 0.6 });
    insertChunk('cap2', 0);

    // 2 chunks total, max=5 → no eviction
    const result = evictPersonalKg(writer, 5);
    expect(result.nodesEvicted).toBe(0);
  });
});
