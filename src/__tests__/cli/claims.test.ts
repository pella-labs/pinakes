import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { closeDb, openDb, type DbBundle } from '../../db/client.js';
import {
  extractClaimsFromFile,
  parseExtractionResponse,
  extractAllClaims,
  queryClaims,
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

const VALID_JSON_RESPONSE = JSON.stringify({
  topics: [
    { topic: 'Authentication', claims: ['Uses OAuth2 for SSO', 'JWT tokens expire after 1 hour'] },
    { topic: 'Database', claims: ['PostgreSQL 15 is required'] },
  ],
});

const FENCED_JSON_RESPONSE = `Here are the extracted claims:

\`\`\`json
${VALID_JSON_RESPONSE}
\`\`\`

These are the key topics discussed.`;

describe('cli/claims (Phase 9.2 D41/D45)', () => {
  let ctx: TestContext | null = null;

  beforeEach(() => {
    const tmp = mkdtempSync(join(tmpdir(), 'pinakes-claims-'));
    const dbPath = join(tmp, 'test.db');
    const bundle = openDb(dbPath);
    // Ensure claims table exists
    bundle.writer.exec(`
      CREATE TABLE IF NOT EXISTS pinakes_claims (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        scope TEXT NOT NULL,
        source_uri TEXT NOT NULL,
        chunk_id TEXT,
        topic TEXT NOT NULL,
        claim TEXT NOT NULL,
        extracted_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_claims_topic ON pinakes_claims(scope, topic);
      CREATE INDEX IF NOT EXISTS idx_claims_source ON pinakes_claims(scope, source_uri);
    `);
    ctx = { tmp, bundle };
  });

  afterEach(() => {
    if (ctx) {
      closeDb(ctx.bundle);
      rmSync(ctx.tmp, { recursive: true, force: true });
      ctx = null;
    }
  });

  // --- parseExtractionResponse ---

  it('parses valid LLM JSON response', () => {
    const result = parseExtractionResponse(VALID_JSON_RESPONSE);
    expect(result).not.toBeNull();
    expect(result).toHaveLength(2);
    expect(result![0]!.topic).toBe('Authentication');
    expect(result![0]!.claims).toHaveLength(2);
    expect(result![1]!.topic).toBe('Database');
  });

  it('handles JSON wrapped in markdown code fences', () => {
    const result = parseExtractionResponse(FENCED_JSON_RESPONSE);
    expect(result).not.toBeNull();
    expect(result).toHaveLength(2);
    expect(result![0]!.topic).toBe('Authentication');
  });

  it('handles malformed LLM response gracefully', () => {
    expect(parseExtractionResponse('This is not JSON at all')).toBeNull();
    expect(parseExtractionResponse('{"topics": "not an array"}')).toBeNull();
    expect(parseExtractionResponse('')).toBeNull();
    expect(parseExtractionResponse('```\n{broken json\n```')).toBeNull();
  });

  // --- extractClaimsFromFile ---

  it('extracts claims from file content via LLM', async () => {
    const provider = mockLlmProvider(VALID_JSON_RESPONSE);
    const claims = await extractClaimsFromFile(
      '# Auth\nWe use OAuth2 for SSO.',
      'auth.md',
      provider,
    );

    expect(claims).toHaveLength(3);
    expect(claims[0]!.topic).toBe('authentication');
    expect(claims[0]!.claim).toBe('Uses OAuth2 for SSO');
    expect(claims[0]!.source_uri).toBe('auth.md');
  });

  it('returns empty array on LLM failure', async () => {
    const provider = mockLlmProvider('garbage output with no JSON');
    const claims = await extractClaimsFromFile('content', 'file.md', provider);
    expect(claims).toHaveLength(0);
  });

  // --- extractAllClaims + persistence ---

  it('persists claims to pinakes_claims table', async () => {
    const { bundle } = ctx!;
    // Seed a node and chunk
    seedNode(bundle, 'project', 'test.md', 'sha-abc', 'Test page content');

    const provider = mockLlmProvider(VALID_JSON_RESPONSE);
    const result = await extractAllClaims(bundle.writer, 'project', provider);

    expect(result.files_processed).toBe(1);
    expect(result.claims_extracted).toBe(3);

    const claims = queryClaims(bundle.writer, 'project');
    expect(claims).toHaveLength(3);
    expect(claims[0]!.source_uri).toBe('test.md');
  });

  it('skips unchanged files (incremental extraction)', async () => {
    const { bundle } = ctx!;
    seedNode(bundle, 'project', 'test.md', 'sha-abc', 'Content');

    const provider = mockLlmProvider(VALID_JSON_RESPONSE);

    // First run — processes the file
    const r1 = await extractAllClaims(bundle.writer, 'project', provider);
    expect(r1.files_processed).toBe(1);
    expect(r1.files_skipped).toBe(0);

    // Second run — same sha, should skip
    const r2 = await extractAllClaims(bundle.writer, 'project', provider);
    expect(r2.files_processed).toBe(0);
    expect(r2.files_skipped).toBe(1);

    // LLM should have been called only once
    expect(provider.complete).toHaveBeenCalledTimes(1);
  });

  it('re-extracts when file changes (different source_sha)', async () => {
    const { bundle } = ctx!;
    seedNode(bundle, 'project', 'test.md', 'sha-abc', 'Original content');

    const provider = mockLlmProvider(VALID_JSON_RESPONSE);

    // First run
    await extractAllClaims(bundle.writer, 'project', provider);
    expect(queryClaims(bundle.writer, 'project')).toHaveLength(3);

    // Simulate file change — update source_sha
    bundle.writer.prepare(`UPDATE pinakes_nodes SET source_sha = ? WHERE source_uri = ?`).run('sha-def', 'test.md');

    // Second run — should re-extract
    const r2 = await extractAllClaims(bundle.writer, 'project', provider);
    expect(r2.files_processed).toBe(1);
    expect(r2.files_skipped).toBe(0);

    // Old claims deleted, new ones inserted (same count since same mock response)
    expect(queryClaims(bundle.writer, 'project')).toHaveLength(3);
  });

  it('reports progress via onTick callback', async () => {
    const { bundle } = ctx!;
    seedNode(bundle, 'project', 'file-a.md', 'sha-a', 'Content A');
    seedNode(bundle, 'project', 'file-b.md', 'sha-b', 'Content B');

    const provider = mockLlmProvider(VALID_JSON_RESPONSE);
    const ticks: string[] = [];

    await extractAllClaims(bundle.writer, 'project', provider, (uri, detail) => {
      ticks.push(`${uri}: ${detail}`);
    });

    expect(ticks).toHaveLength(2);
    expect(ticks[0]).toContain('file-a.md');
    expect(ticks[1]).toContain('file-b.md');
  });

  it('multiple files produce claims with correct provenance', async () => {
    const { bundle } = ctx!;
    seedNode(bundle, 'project', 'auth.md', 'sha-1', 'Auth content');
    seedNode(bundle, 'project', 'db.md', 'sha-2', 'DB content');

    const provider = mockLlmProvider(VALID_JSON_RESPONSE);
    await extractAllClaims(bundle.writer, 'project', provider);

    const claims = queryClaims(bundle.writer, 'project');
    const authClaims = claims.filter((c) => c.source_uri === 'auth.md');
    const dbClaims = claims.filter((c) => c.source_uri === 'db.md');

    expect(authClaims.length).toBeGreaterThan(0);
    expect(dbClaims.length).toBeGreaterThan(0);
  });
});

// Helpers for seeding test data
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
       (id, scope, source_uri, section_path, kind, title, content, source_sha, token_count, confidence, created_at, updated_at, last_accessed_at)
       VALUES (?, ?, ?, '/', 'section', ?, ?, ?, 100, 'extracted', ?, ?, ?)`,
    )
    .run(nodeId, scope, sourceUri, sourceUri, content, sourceSha, now, now, now);

  bundle.writer
    .prepare(
      `INSERT OR REPLACE INTO pinakes_chunks (id, node_id, chunk_index, text, chunk_sha, token_count, created_at)
       VALUES (?, ?, 0, ?, 'sha-chunk', 50, ?)`,
    )
    .run(chunkId, nodeId, content, now);
}
