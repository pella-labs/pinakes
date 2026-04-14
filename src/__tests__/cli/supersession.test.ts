import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { closeDb, openDb, type DbBundle } from '../../db/client.js';
import {
  extractAllClaims,
  queryClaims,
  queryClaimHistory,
  queryRecentlySuperseded,
  pruneVersionChains,
  type ClaimVersion,
  type SupersededClaim,
} from '../../cli/claims.js';
import type { LlmProvider } from '../../llm/provider.js';

interface TestContext {
  tmp: string;
  bundle: DbBundle;
}

function mockLlmProvider(response: string): LlmProvider {
  return {
    name: 'mock',
    available: () => true,
    complete: vi.fn().mockResolvedValue(response),
  };
}

function mockLlmProviderSequence(responses: string[]): LlmProvider {
  const fn = vi.fn();
  for (const r of responses) {
    fn.mockResolvedValueOnce(r);
  }
  return {
    name: 'mock',
    available: () => true,
    complete: fn,
  };
}

const RESPONSE_A_B = JSON.stringify({
  topics: [
    { topic: 'Authentication', claims: ['Uses OAuth2 for SSO'] },
    { topic: 'Database', claims: ['PostgreSQL 15 is required'] },
  ],
});

const RESPONSE_A_CHANGED = JSON.stringify({
  topics: [
    { topic: 'Authentication', claims: ['Uses SAML for SSO'] },
    { topic: 'Database', claims: ['PostgreSQL 16 is required'] },
  ],
});

const RESPONSE_A_ONLY = JSON.stringify({
  topics: [
    { topic: 'Authentication', claims: ['Uses OAuth2 for SSO'] },
  ],
});

describe('cli/claims — Phase 11.2 Supersession Tracking', () => {
  let ctx: TestContext | null = null;

  beforeEach(() => {
    const tmp = mkdtempSync(join(tmpdir(), 'pinakes-supersession-'));
    const dbPath = join(tmp, 'test.db');
    const bundle = openDb(dbPath);
    ctx = { tmp, bundle };
  });

  afterEach(() => {
    if (ctx) {
      closeDb(ctx.bundle);
      rmSync(ctx.tmp, { recursive: true, force: true });
      ctx = null;
    }
  });

  // --- Test 1: Idempotency ---

  it('re-extraction of unchanged claims preserves versions (idempotent)', async () => {
    const { bundle } = ctx!;
    seedNode(bundle, 'project', 'test.md', 'sha-abc', 'Content');

    const provider = mockLlmProvider(RESPONSE_A_B);

    // First run
    await extractAllClaims(bundle.writer, 'project', provider);
    const claimsV1 = queryClaims(bundle.writer, 'project');
    expect(claimsV1).toHaveLength(2);

    // Second run — same sha, should skip entirely
    await extractAllClaims(bundle.writer, 'project', provider);
    const claimsV2 = queryClaims(bundle.writer, 'project');
    expect(claimsV2).toHaveLength(2);

    // Versions should be identical (no supersession happened)
    const history = queryClaimHistory(bundle.writer, 'project', 'authentication');
    expect(history).toHaveLength(1);
    expect(history[0]!.version).toBe(1);
    expect(history[0]!.superseded_at).toBeNull();
  });

  // --- Test 2: Changed claim is superseded ---

  it('changed claim gets superseded with superseded_by pointing to new claim', async () => {
    const { bundle } = ctx!;
    seedNode(bundle, 'project', 'test.md', 'sha-abc', 'Content');

    const provider = mockLlmProviderSequence([RESPONSE_A_B, RESPONSE_A_CHANGED]);

    // First extraction
    await extractAllClaims(bundle.writer, 'project', provider);

    // Simulate file change
    bundle.writer.prepare(`UPDATE pinakes_nodes SET source_sha = ? WHERE source_uri = ?`).run('sha-def', 'test.md');

    // Second extraction with changed claims
    await extractAllClaims(bundle.writer, 'project', provider);

    // Active claims should be the new ones
    const active = queryClaims(bundle.writer, 'project');
    expect(active).toHaveLength(2);
    const authClaim = active.find((c) => c.topic === 'authentication');
    expect(authClaim!.claim).toBe('Uses SAML for SSO');

    // Old claims should be superseded
    const history = queryClaimHistory(bundle.writer, 'project', 'authentication');
    expect(history).toHaveLength(2);
    // Newest first
    const newest = history[0]!;
    const oldest = history[1]!;
    expect(newest.superseded_at).toBeNull(); // active
    expect(oldest.superseded_at).not.toBeNull(); // superseded
    expect(oldest.superseded_by).toBe(newest.id);
  });

  // --- Test 3: New claim gets version = old_version + 1 ---

  it('new claim gets version = old_version + 1', async () => {
    const { bundle } = ctx!;
    seedNode(bundle, 'project', 'test.md', 'sha-abc', 'Content');

    const provider = mockLlmProviderSequence([RESPONSE_A_B, RESPONSE_A_CHANGED]);

    await extractAllClaims(bundle.writer, 'project', provider);
    bundle.writer.prepare(`UPDATE pinakes_nodes SET source_sha = ? WHERE source_uri = ?`).run('sha-def', 'test.md');
    await extractAllClaims(bundle.writer, 'project', provider);

    const history = queryClaimHistory(bundle.writer, 'project', 'authentication');
    expect(history[0]!.version).toBe(2);
    expect(history[1]!.version).toBe(1);
  });

  // --- Test 4: Retired claim (no successor) ---

  it('retired claim has superseded_by=null and superseded_at set', async () => {
    const { bundle } = ctx!;
    seedNode(bundle, 'project', 'test.md', 'sha-abc', 'Content');

    // First: topics A and B
    const provider = mockLlmProviderSequence([RESPONSE_A_B, RESPONSE_A_ONLY]);

    await extractAllClaims(bundle.writer, 'project', provider);
    expect(queryClaims(bundle.writer, 'project')).toHaveLength(2);

    // Simulate file change
    bundle.writer.prepare(`UPDATE pinakes_nodes SET source_sha = ? WHERE source_uri = ?`).run('sha-def', 'test.md');

    // Second: only topic A → topic B is retired
    await extractAllClaims(bundle.writer, 'project', provider);

    // Only 1 active claim (authentication)
    const active = queryClaims(bundle.writer, 'project');
    expect(active).toHaveLength(1);
    expect(active[0]!.topic).toBe('authentication');

    // Database claim is superseded with no successor
    const dbHistory = queryClaimHistory(bundle.writer, 'project', 'database');
    expect(dbHistory).toHaveLength(1);
    expect(dbHistory[0]!.superseded_at).not.toBeNull();
    expect(dbHistory[0]!.superseded_by).toBeNull(); // retired, no successor
  });

  // --- Test 5: Version chain pruning ---

  it('prunes version chains beyond MAX_CLAIM_VERSIONS', () => {
    const { bundle } = ctx!;
    const now = Date.now();

    // Manually insert 6 claims for the same topic (versions 1-6, first 5 superseded)
    const insertStmt = bundle.writer.prepare(
      `INSERT INTO pinakes_claims (scope, source_uri, topic, claim, extracted_at, version, superseded_by, superseded_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    const ids: number[] = [];
    for (let v = 1; v <= 6; v++) {
      const info = insertStmt.run(
        'project', 'test.md', 'authentication',
        `Claim v${v}`, now, v,
        v < 6 ? null : null,  // will fix pointers below
        v < 6 ? now - (6 - v) * 1000 : null,  // superseded_at for v1-v5, null for v6 (active)
      );
      ids.push(Number(info.lastInsertRowid));
    }

    // Set superseded_by pointers: v1→v2, v2→v3, etc.
    for (let i = 0; i < 5; i++) {
      bundle.writer
        .prepare(`UPDATE pinakes_claims SET superseded_by = ? WHERE id = ?`)
        .run(ids[i + 1], ids[i]);
    }

    // Verify 6 claims exist
    const before = queryClaimHistory(bundle.writer, 'project', 'authentication');
    expect(before).toHaveLength(6);

    // Prune — should keep newest 5 (versions 2-6)
    pruneVersionChains(bundle.writer, 'project', 'test.md');

    const after = queryClaimHistory(bundle.writer, 'project', 'authentication');
    expect(after).toHaveLength(5);
    // Oldest (version 1) should be gone
    expect(after.find((c) => c.version === 1)).toBeUndefined();
    // Newest (version 6) should still be active
    expect(after.find((c) => c.version === 6)?.superseded_at).toBeNull();
  });

  // --- Test 6: queryClaimHistory returns ordered version chain ---

  it('queryClaimHistory returns ordered version chain', () => {
    const { bundle } = ctx!;
    const now = Date.now();

    // Insert 3 claims with versions 1, 2, 3
    const insertStmt = bundle.writer.prepare(
      `INSERT INTO pinakes_claims (scope, source_uri, topic, claim, extracted_at, version, superseded_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    insertStmt.run('project', 'test.md', 'database', 'PG 14', now, 1, now - 2000);
    insertStmt.run('project', 'test.md', 'database', 'PG 15', now, 2, now - 1000);
    insertStmt.run('project', 'test.md', 'database', 'PG 16', now, 3, null);

    const history = queryClaimHistory(bundle.writer, 'project', 'database');
    expect(history).toHaveLength(3);
    expect(history[0]!.version).toBe(3); // newest first
    expect(history[1]!.version).toBe(2);
    expect(history[2]!.version).toBe(1);
  });

  // --- Test 7: queryRecentlySuperseded filters by timestamp ---

  it('queryRecentlySuperseded filters by timestamp', () => {
    const { bundle } = ctx!;
    const now = Date.now();
    const oneHourAgo = now - 3600_000;
    const twoHoursAgo = now - 7200_000;

    const insertStmt = bundle.writer.prepare(
      `INSERT INTO pinakes_claims (scope, source_uri, topic, claim, extracted_at, version, superseded_at, superseded_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    // Old superseded claim (2 hours ago)
    insertStmt.run('project', 'test.md', 'auth', 'Old claim', now, 1, twoHoursAgo, null);
    // Recent superseded claim (now)
    insertStmt.run('project', 'test.md', 'database', 'Recent claim', now, 1, now, null);

    // Without filter — returns both
    const all = queryRecentlySuperseded(bundle.writer, 'project');
    expect(all).toHaveLength(2);

    // With filter — only recent
    const recent = queryRecentlySuperseded(bundle.writer, 'project', oneHourAgo);
    expect(recent).toHaveLength(1);
    expect(recent[0]!.topic).toBe('database');
  });

  // --- Test 8: Confidence penalty/boost on supersession ---

  it('applies confidence penalty and boost on supersession', async () => {
    const { bundle } = ctx!;
    seedNode(bundle, 'project', 'test.md', 'sha-abc', 'Content');

    // Set initial confidence to a known value
    bundle.writer.prepare(`UPDATE pinakes_nodes SET confidence_score = 0.7 WHERE source_uri = ?`).run('test.md');

    const provider = mockLlmProviderSequence([RESPONSE_A_B, RESPONSE_A_CHANGED]);

    // First extraction (no supersession, no confidence change from supersession)
    await extractAllClaims(bundle.writer, 'project', provider);

    // Check confidence unchanged from supersession (only first run, no old claims)
    const scoreAfterFirst = bundle.writer
      .prepare<[string], { confidence_score: number }>(`SELECT confidence_score FROM pinakes_nodes WHERE source_uri = ?`)
      .get('test.md');
    expect(scoreAfterFirst!.confidence_score).toBe(0.7);

    // Simulate file change
    bundle.writer.prepare(`UPDATE pinakes_nodes SET source_sha = ? WHERE source_uri = ?`).run('sha-def', 'test.md');

    // Second extraction — triggers supersession
    await extractAllClaims(bundle.writer, 'project', provider);

    // Confidence should have penalty (-0.05) then boost (+0.05) = net 0
    // But the operations are sequential: first MAX(0.1, 0.7 - 0.05) = 0.65, then MIN(1.0, 0.65 + 0.05) = 0.7
    const scoreAfterSecond = bundle.writer
      .prepare<[string], { confidence_score: number }>(`SELECT confidence_score FROM pinakes_nodes WHERE source_uri = ?`)
      .get('test.md');
    expect(scoreAfterSecond!.confidence_score).toBe(0.7);
  });

  // --- Test 9: queryClaims excludes superseded claims ---

  it('queryClaims only returns active (non-superseded) claims', () => {
    const { bundle } = ctx!;
    const now = Date.now();

    const insertStmt = bundle.writer.prepare(
      `INSERT INTO pinakes_claims (scope, source_uri, topic, claim, extracted_at, version, superseded_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    insertStmt.run('project', 'test.md', 'auth', 'Active claim', now, 2, null);
    insertStmt.run('project', 'test.md', 'auth', 'Superseded claim', now, 1, now);

    const active = queryClaims(bundle.writer, 'project');
    expect(active).toHaveLength(1);
    expect(active[0]!.claim).toBe('Active claim');
  });

  // --- Test 10: queryRecentlySuperseded resolves successor claim text ---

  it('queryRecentlySuperseded resolves successor claim text', () => {
    const { bundle } = ctx!;
    const now = Date.now();

    const insertStmt = bundle.writer.prepare(
      `INSERT INTO pinakes_claims (scope, source_uri, topic, claim, extracted_at, version, superseded_at, superseded_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    // Insert successor first to get its ID
    const successorInfo = insertStmt.run('project', 'test.md', 'auth', 'New OAuth3', now, 2, null, null);
    const successorId = Number(successorInfo.lastInsertRowid);

    // Insert superseded claim pointing to successor
    insertStmt.run('project', 'test.md', 'auth', 'Old OAuth2', now, 1, now, successorId);

    const superseded = queryRecentlySuperseded(bundle.writer, 'project');
    expect(superseded).toHaveLength(1);
    expect(superseded[0]!.old_claim).toBe('Old OAuth2');
    expect(superseded[0]!.new_claim).toBe('New OAuth3');
    expect(superseded[0]!.old_version).toBe(1);
    expect(superseded[0]!.new_version).toBe(2);
  });
});

// Helpers

function seedNode(
  bundle: DbBundle,
  scope: string,
  sourceUri: string,
  sourceSha: string,
  content: string,
): void {
  const nodeId = `node-${sourceUri}`;
  const chunkId = `chunk-${sourceUri}`;
  const now = Date.now();

  bundle.writer
    .prepare(
      `INSERT OR REPLACE INTO pinakes_nodes
       (id, scope, source_uri, section_path, kind, title, content, source_sha, token_count, confidence, confidence_score, created_at, updated_at, last_accessed_at)
       VALUES (?, ?, ?, '/', 'section', ?, ?, ?, 100, 'extracted', 0.7, ?, ?, ?)`,
    )
    .run(nodeId, scope, sourceUri, sourceUri, content, sourceSha, now, now, now);

  bundle.writer
    .prepare(
      `INSERT OR REPLACE INTO pinakes_chunks (id, node_id, chunk_index, text, chunk_sha, token_count, created_at)
       VALUES (?, ?, 0, ?, 'sha-chunk', 50, ?)`,
    )
    .run(chunkId, nodeId, content, now);
}
