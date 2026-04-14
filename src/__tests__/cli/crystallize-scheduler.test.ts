import {
  mkdirSync,
  mkdtempSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { closeDb, openDb, type DbBundle } from '../../db/client.js';
import { CrystallizationScheduler } from '../../cli/crystallize-scheduler.js';

// Control mocks via shared state
let mockHead: string | null = 'abc123';
let mockLlmAvailable = false;
let crystallizeCalls = 0;

vi.mock('../../cli/crystallize.js', () => ({
  getGitHead: () => mockHead,
  crystallizeCommand: vi.fn().mockImplementation(async () => {
    crystallizeCalls++;
    return { drafts_created: 0, output_dir: '/tmp', skipped_reason: 'mock' };
  }),
}));

vi.mock('../../llm/provider.js', () => ({
  createLlmProvider: () => ({
    name: 'mock',
    available: () => mockLlmAvailable,
    complete: vi.fn().mockResolvedValue(''),
  }),
}));

describe('CrystallizationScheduler', () => {
  let tmp: string;
  let bundle: DbBundle;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'pinakes-sched-'));
    const dbDir = join(tmp, 'db');
    mkdirSync(dbDir, { recursive: true });
    bundle = openDb(join(dbDir, 'pinakes.db'));
    // Reset state
    mockHead = 'abc123';
    mockLlmAvailable = false;
    crystallizeCalls = 0;
  });

  afterEach(() => {
    closeDb(bundle);
    rmSync(tmp, { recursive: true, force: true });
  });

  it('starts and stops without error', () => {
    const scheduler = new CrystallizationScheduler(tmp, bundle.writer);
    scheduler.start();
    scheduler.stop();
  });

  it('rate-limits: skips if last run was less than 1h ago', async () => {
    mockLlmAvailable = true;
    // Different head to trigger startup
    bundle.writer
      .prepare(`INSERT OR REPLACE INTO pinakes_meta (key, value) VALUES ('last_crystallize_head', ?)`)
      .run('old-head');
    // But recent timestamp blocks it
    bundle.writer
      .prepare(`INSERT OR REPLACE INTO pinakes_meta (key, value) VALUES ('last_crystallize_ts', ?)`)
      .run(String(Date.now()));

    const scheduler = new CrystallizationScheduler(tmp, bundle.writer);
    scheduler.start();
    await new Promise((r) => setTimeout(r, 100));
    scheduler.stop();

    expect(crystallizeCalls).toBe(0);
  });

  it('triggers on startup when HEAD differs from stored', async () => {
    mockLlmAvailable = true;
    mockHead = 'new-head-123';
    bundle.writer
      .prepare(`INSERT OR REPLACE INTO pinakes_meta (key, value) VALUES ('last_crystallize_head', ?)`)
      .run('old-head-456');

    const scheduler = new CrystallizationScheduler(tmp, bundle.writer);
    scheduler.start();
    await new Promise((r) => setTimeout(r, 150));
    scheduler.stop();

    expect(crystallizeCalls).toBe(1);
  });

  it('does not trigger when LLM is unavailable', async () => {
    mockLlmAvailable = false;
    bundle.writer
      .prepare(`INSERT OR REPLACE INTO pinakes_meta (key, value) VALUES ('last_crystallize_head', ?)`)
      .run('old-head');

    const scheduler = new CrystallizationScheduler(tmp, bundle.writer);
    scheduler.start();
    await new Promise((r) => setTimeout(r, 100));
    scheduler.stop();

    expect(crystallizeCalls).toBe(0);
  });

  it('does not trigger when HEAD is null (not a git repo)', async () => {
    mockHead = null;
    mockLlmAvailable = true;

    const scheduler = new CrystallizationScheduler(tmp, bundle.writer);
    scheduler.start();
    await new Promise((r) => setTimeout(r, 100));
    scheduler.stop();

    expect(crystallizeCalls).toBe(0);
  });
});
