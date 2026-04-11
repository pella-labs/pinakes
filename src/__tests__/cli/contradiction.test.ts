import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { closeDb, openDb, type DbBundle } from '../../db/client.js';
import {
  contradictionScan,
  _parseJudgment,
} from '../../../src/cli/contradiction.js';
import type { LlmProvider } from '../../llm/provider.js';

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

function disabledLlmProvider(): LlmProvider {
  return {
    name: 'disabled',
    available: () => false,
    complete: vi.fn(),
  };
}

describe('cli/contradiction (Phase 8 H)', () => {
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

  it('rate limits to 1 scan per hour', async () => {
    const c = ctx!;
    // Set last scan to now
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
    // Set last scan to 2 hours ago
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

  it('throws when LLM provider is unavailable', async () => {
    const c = ctx!;
    await expect(
      contradictionScan({
        bundle: c.bundle,
        scope: 'project',
        llmProvider: disabledLlmProvider(),
        wikiRoot: c.wikiDir,
      })
    ).rejects.toThrow(/No LLM provider available/);
  });

  it('returns 0 pairs when wiki has < 2 chunks', async () => {
    const c = ctx!;
    const result = await contradictionScan({
      bundle: c.bundle,
      scope: 'project',
      llmProvider: mockLlmProvider('{}'),
      wikiRoot: c.wikiDir,
    });

    expect(result.scanned_pairs).toBe(0);
    expect(result.contradictions).toEqual([]);
  });

  describe('parseJudgment', () => {
    it('parses valid contradiction response', () => {
      const result = _parseJudgment(
        '{"contradicts": true, "explanation": "different values", "confidence": "high"}'
      );
      expect(result).toEqual({
        contradicts: true,
        explanation: 'different values',
        confidence: 'high',
      });
    });

    it('parses non-contradiction response', () => {
      const result = _parseJudgment(
        '{"contradicts": false, "explanation": "consistent", "confidence": "high"}'
      );
      expect(result?.contradicts).toBe(false);
    });

    it('returns null for invalid JSON', () => {
      expect(_parseJudgment('not json')).toBeNull();
    });

    it('extracts JSON from surrounding text', () => {
      const result = _parseJudgment(
        'Here is my analysis:\n{"contradicts": true, "explanation": "mismatch", "confidence": "medium"}\nDone.'
      );
      expect(result?.contradicts).toBe(true);
    });
  });
});
