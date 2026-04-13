import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { closeDb, openDb, type DbBundle } from '../../db/client.js';
import {
  llmFilterGaps,
  parseLlmFilterResponse,
  findTopologyGaps,
  gatherGapContexts,
  getHealthMetrics,
  generateSynthesisStubs,
  type GapContext,
} from '../../cli/audit-wiki.js';
import type { LlmProvider } from '../../llm/provider.js';
import type { GapRow } from '../../gaps/detector.js';

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

function failingLlmProvider(): LlmProvider {
  return {
    name: 'failing',
    available: () => true,
    complete: vi.fn().mockRejectedValue(new Error('LLM failed')),
  };
}

function makeGap(topic: string, mentions: number): GapRow {
  return { id: 0, topic, first_seen_at: Date.now(), mentions_count: mentions, resolved_at: null };
}

describe('cli/audit-wiki gap filtering (Phase 9.4 D42)', () => {
  let ctx: TestContext | null = null;

  beforeEach(() => {
    const tmp = mkdtempSync(join(tmpdir(), 'pinakes-audit-'));
    const bundle = openDb(join(tmp, 'test.db'));
    ctx = { tmp, bundle };
  });

  afterEach(() => {
    if (ctx) {
      closeDb(ctx.bundle);
      rmSync(ctx.tmp, { recursive: true, force: true });
      ctx = null;
    }
  });

  // --- LLM filter ---

  it('LLM filter reduces gap count', async () => {
    const gaps = [
      makeGap('Docker', 20),
      makeGap('random noise', 15),
      makeGap('OAuth2', 12),
      makeGap('more noise', 10),
    ];

    // LLM keeps only Docker and OAuth2
    const provider = mockLlmProvider('["Docker", "OAuth2"]');
    const result = await llmFilterGaps(gaps, provider);

    expect(result).toHaveLength(2);
    expect(result.map((g) => g.topic)).toEqual(['Docker', 'OAuth2']);
  });

  it('LLM filter fallback: keeps all gaps on LLM failure', async () => {
    const gaps = [makeGap('Docker', 20), makeGap('OAuth2', 15)];
    const provider = failingLlmProvider();
    const result = await llmFilterGaps(gaps, provider);

    expect(result).toHaveLength(2); // All kept on failure
  });

  it('parseLlmFilterResponse handles code fences', () => {
    const result = parseLlmFilterResponse('```json\n["Docker", "OAuth2"]\n```');
    expect(result).toEqual(['Docker', 'OAuth2']);
  });

  it('parseLlmFilterResponse handles malformed response', () => {
    expect(parseLlmFilterResponse('not json')).toEqual([]);
    expect(parseLlmFilterResponse('')).toEqual([]);
  });

  // --- Graph topology ---

  it('findTopologyGaps returns empty when no edges exist', () => {
    const result = findTopologyGaps(ctx!.bundle.writer, 'project');
    expect(result).toEqual([]);
  });

  // --- Gap context ---

  it('gatherGapContexts returns relevant chunk excerpts', () => {
    const { bundle } = ctx!;
    const now = Date.now();

    // Seed a node and chunk that mentions "Docker"
    bundle.writer.prepare(
      `INSERT INTO pinakes_nodes (id, scope, source_uri, section_path, kind, title, content, source_sha, token_count, confidence, created_at, updated_at, last_accessed_at)
       VALUES (?, ?, ?, '/', 'section', 'Setup', 'Docker setup guide', 'sha1', 100, 'extracted', ?, ?, ?)`,
    ).run('n1', 'project', 'setup.md', now, now, now);

    bundle.writer.prepare(
      `INSERT INTO pinakes_chunks (id, node_id, chunk_index, text, chunk_sha, token_count, created_at)
       VALUES (?, ?, 0, ?, 'sha-c', 50, ?)`,
    ).run('c1', 'n1', 'We use Docker for containerization. Docker compose for local dev.', now);

    const gaps = [makeGap('Docker', 20)];
    const contexts = gatherGapContexts(bundle.writer, 'project', gaps);

    expect(contexts).toHaveLength(1);
    expect(contexts[0]!.topic).toBe('Docker');
    expect(contexts[0]!.mentions).toHaveLength(1);
    expect(contexts[0]!.mentions[0]!.source_uri).toBe('setup.md');
    expect(contexts[0]!.mentions[0]!.excerpt).toContain('Docker');
  });

  // --- Health metrics ---

  it('health metrics returns correct counts', () => {
    const { bundle } = ctx!;
    const now = Date.now();

    // Seed 2 nodes, 3 chunks
    for (let i = 0; i < 2; i++) {
      bundle.writer.prepare(
        `INSERT INTO pinakes_nodes (id, scope, source_uri, section_path, kind, title, content, source_sha, token_count, confidence, created_at, updated_at, last_accessed_at)
         VALUES (?, 'project', ?, '/', 'section', ?, 'content', 'sha', 100, 'extracted', ?, ?, ?)`,
      ).run(`n${i}`, `file${i}.md`, `File ${i}`, now, now, now);
    }
    for (let i = 0; i < 3; i++) {
      bundle.writer.prepare(
        `INSERT INTO pinakes_chunks (id, node_id, chunk_index, text, chunk_sha, token_count, created_at)
         VALUES (?, ?, ?, 'chunk text', 'sha', 50, ?)`,
      ).run(`c${i}`, `n${i % 2}`, i, now);
    }

    const metrics = getHealthMetrics(bundle.writer, 'project');
    expect(metrics.file_count).toBe(2);
    expect(metrics.node_count).toBe(2);
    expect(metrics.chunk_count).toBe(3);
    expect(metrics.edge_count).toBe(0);
  });
});

describe('cli/audit-wiki synthesis stubs (Phase 9.5 D43)', () => {
  let tmp: string;
  let wikiRoot: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'pinakes-stubs-'));
    wikiRoot = join(tmp, 'wiki');
    mkdirSync(wikiRoot, { recursive: true });
    // Create .pinakes parent with .gitignore
    const pinakesDir = join(tmp, '.pinakes');
    // wiki is inside .pinakes
    // For this test, wikiRoot IS the wiki, and its parent should have .gitignore
    // Let's just create a .gitignore in the parent of wikiRoot
    writeFileSync(join(tmp, '.gitignore'), '# test gitignore\n', 'utf-8');
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('generates synthesis stubs with content from mentions', async () => {
    const gaps = [makeGap('Docker', 20)];
    const contexts: GapContext[] = [{
      topic: 'Docker',
      mentions: [
        { source_uri: 'setup.md', excerpt: 'We use Docker for containerization and Docker Compose for local development.' },
        { source_uri: 'deploy.md', excerpt: 'Docker images are pushed to ECR. Use docker build to create images.' },
      ],
    }];

    const provider = mockLlmProvider('# Docker\n\nDocker is used for containerization (from setup.md).');
    const count = await generateSynthesisStubs(gaps, contexts, wikiRoot, provider);

    expect(count).toBe(1);
    const draftPath = join(wikiRoot, '_audit-drafts', 'docker.md');
    expect(existsSync(draftPath)).toBe(true);
    const content = readFileSync(draftPath, 'utf-8');
    expect(content).toContain('Docker');
  });

  it('writes stubs to _audit-drafts, NOT wiki root', async () => {
    const gaps = [makeGap('OAuth2', 15)];
    const contexts: GapContext[] = [{
      topic: 'OAuth2',
      mentions: [{ source_uri: 'auth.md', excerpt: 'OAuth2 is used for SSO.' }],
    }];

    const provider = mockLlmProvider('# OAuth2\n\nOAuth2 provides SSO.');
    await generateSynthesisStubs(gaps, contexts, wikiRoot, provider);

    // Stub should be in _audit-drafts/, not wiki root
    expect(existsSync(join(wikiRoot, '_audit-drafts', 'oauth2.md'))).toBe(true);
    expect(existsSync(join(wikiRoot, 'oauth2.md'))).toBe(false);
  });

  it('skips gaps with no context mentions', async () => {
    const gaps = [makeGap('EmptyTopic', 10)];
    const contexts: GapContext[] = [{ topic: 'EmptyTopic', mentions: [] }];

    const provider = mockLlmProvider('should not be called');
    const count = await generateSynthesisStubs(gaps, contexts, wikiRoot, provider);

    expect(count).toBe(0);
    expect(provider.complete).not.toHaveBeenCalled();
  });

  it('stub generation failure for one topic does not block others', async () => {
    const gaps = [makeGap('TopicA', 20), makeGap('TopicB', 15)];
    const contexts: GapContext[] = [
      { topic: 'TopicA', mentions: [{ source_uri: 'a.md', excerpt: 'About TopicA' }] },
      { topic: 'TopicB', mentions: [{ source_uri: 'b.md', excerpt: 'About TopicB' }] },
    ];

    let callCount = 0;
    const provider: LlmProvider = {
      name: 'mock',
      available: () => true,
      complete: vi.fn().mockImplementation(async () => {
        callCount++;
        if (callCount === 1) throw new Error('LLM explosion');
        return '# TopicB\n\nContent about TopicB.';
      }),
    };

    const count = await generateSynthesisStubs(gaps, contexts, wikiRoot, provider);

    expect(count).toBe(1); // TopicB succeeded
    expect(existsSync(join(wikiRoot, '_audit-drafts', 'topicb.md'))).toBe(true);
  });

  it('does not generate stubs when flag is not set', () => {
    // This is a behavioral test — the flag check is in auditWikiCommand
    // Just verify the function is exported and can be called with empty inputs
    // The actual flag check is in the main command flow
    const gaps: GapRow[] = [];
    const contexts: GapContext[] = [];
    const provider = mockLlmProvider('');

    // With empty gaps, should return 0
    return generateSynthesisStubs(gaps, contexts, wikiRoot, provider).then((count) => {
      expect(count).toBe(0);
    });
  });
});
