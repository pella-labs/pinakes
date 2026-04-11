import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ChokidarWatcher } from '../../ingest/chokidar.js';
import type { IngestEvent } from '../../ingest/source.js';

/**
 * ChokidarWatcher tests for KG-MCP Phase 2.
 *
 * Four behaviors locked in by tests:
 *   1. event triggers ingest — initial scan emits `file:added` for existing files
 *   2. 2-second debounce coalesces 10 rapid events for the same file → 1 dispatch
 *   3. drop-oldest: 3 different content versions queued → only the latest dispatches
 *   4. single-flight handoff: 3 parallel events for the same file → 1 ingest
 *
 * The debounce window is overridden via `debounceMs: 100` so tests run fast.
 * The "real" 2000ms value is locked in production by the chokidar.ts default.
 */

interface TestContext {
  tmp: string;
  wikiDir: string;
  watcher: ChokidarWatcher | null;
  events: IngestEvent[];
}

describe('ingest/chokidar (Phase 2)', () => {
  let ctx: TestContext | null = null;

  beforeEach(() => {
    const tmp = mkdtempSync(join(tmpdir(), 'pinakes-chokidar-'));
    const wikiDir = join(tmp, 'wiki');
    mkdirSync(wikiDir, { recursive: true });
    ctx = { tmp, wikiDir, watcher: null, events: [] };
  });

  afterEach(async () => {
    if (ctx) {
      if (ctx.watcher) await ctx.watcher.stop();
      rmSync(ctx.tmp, { recursive: true, force: true });
      ctx = null;
    }
  });

  it('event triggers ingest: initial scan emits file:added for existing markdown files', async () => {
    const c = ctx!;
    // Pre-create some files BEFORE starting the watcher.
    writeFileSync(join(c.wikiDir, 'a.md'), '# A');
    writeFileSync(join(c.wikiDir, 'b.md'), '# B');
    writeFileSync(join(c.wikiDir, 'ignore.txt'), 'not markdown');

    c.watcher = new ChokidarWatcher({
      rootDir: c.wikiDir,
      scope: 'project',
      debounceMs: 5_000, // long enough that the test never races real timers
    });
    await c.watcher.start(async (ev) => {
      c.events.push(ev);
    });

    // Give chokidar a moment to settle any FSEvents follow-ups (the initial
    // scan can emit `add` then `change` on macOS as metadata is updated).
    await sleep(150);

    // Manually drain the queue — drop-oldest semantics mean only the LATEST
    // event per path remains, even if chokidar emitted multiple.
    await c.watcher.__flushForTests();

    // Two markdown files; the .txt is ignored. Each file produces exactly
    // ONE dispatched event (whichever was the latest queued — `add` or
    // `change` depending on FSEvents timing).
    const mdEvents = c.events.filter((e) => e.path.endsWith('.md'));
    expect(mdEvents.length).toBe(2);
    expect(mdEvents.every((e) => e.kind === 'file:added' || e.kind === 'file:changed')).toBe(true);
    expect(mdEvents.every((e) => e.scope === 'project')).toBe(true);
    expect(c.events.some((e) => e.path.endsWith('ignore.txt'))).toBe(false);

    // Both unique paths are present
    const paths = new Set(mdEvents.map((e) => e.path));
    expect(paths.size).toBe(2);
  });

  it('2-second debounce coalesces rapid events for the same file → 1 dispatch', async () => {
    const c = ctx!;

    c.watcher = new ChokidarWatcher({
      rootDir: c.wikiDir,
      scope: 'project',
      debounceMs: 200, // 200ms test window
    });
    await c.watcher.start(async (ev) => {
      c.events.push(ev);
    });
    // Drain initial scan (no files yet)
    await sleep(50);
    c.events.length = 0;

    // Create a file then mutate it 9 more times in quick succession.
    // Without debounce we'd see ~10 dispatches; with debounce we see exactly 1
    // (the file:added that triggered the timer; the 9 follow-up changes
    // overwrite the queued event but don't restart the timer).
    const file = join(c.wikiDir, 'churn.md');
    writeFileSync(file, '# v0');
    for (let i = 1; i <= 9; i++) {
      writeFileSync(file, `# v${i}`);
    }

    // Wait long enough for the debounce timer to fire
    await sleep(400);

    // Filter to events for our file (chokidar may also emit dir-watch noise)
    const ourEvents = c.events.filter((e) => e.path === resolve(file));
    // Exactly 1 dispatch — the load-bearing 10-events → 1-ingest invariant.
    expect(ourEvents.length).toBe(1);
  });

  it('drop-oldest semantics: queued events for the same path collapse to the latest only', async () => {
    const c = ctx!;
    const file = join(c.wikiDir, 'rapid.md');

    c.watcher = new ChokidarWatcher({
      rootDir: c.wikiDir,
      scope: 'project',
      debounceMs: 5_000, // long enough that we manually flush
    });
    await c.watcher.start(async (ev) => {
      c.events.push(ev);
    });
    await sleep(50);
    c.events.length = 0;

    // Create the file → 1 queued event with kind=file:added
    writeFileSync(file, '# v1');
    await sleep(100);
    expect(c.watcher.__pendingCountForTests()).toBeGreaterThanOrEqual(1);

    // Mutate it twice more → still 1 queued event (now kind=file:changed),
    // because drop-oldest replaces the queued value in place.
    writeFileSync(file, '# v2');
    await sleep(50);
    writeFileSync(file, '# v3');
    await sleep(100);

    // Still exactly 1 entry pending for this path
    expect(c.watcher.__pendingCountForTests()).toBe(1);

    // Now flush and verify ONE dispatch arrived
    await c.watcher.__flushForTests();

    const ourEvents = c.events.filter((e) => e.path === resolve(file));
    expect(ourEvents.length).toBe(1);
    // The dispatched event is one of the change kinds (the LATEST event,
    // which by the time of flush is `file:changed`)
    expect(['file:added', 'file:changed']).toContain(ourEvents[0]!.kind);
  });

  it('single-flight handoff: parallel events for the same path → 1 ingest callback at a time', async () => {
    const c = ctx!;
    const file = join(c.wikiDir, 'parallel.md');

    c.watcher = new ChokidarWatcher({
      rootDir: c.wikiDir,
      scope: 'project',
      debounceMs: 50,
    });

    // Track concurrent in-flight handler calls. The watcher's debounce + the
    // ingester's single-flight gate together ensure that only one handler
    // ever runs for a given path at a time.
    let active = 0;
    let maxConcurrent = 0;
    let totalCalls = 0;
    await c.watcher.start(async (ev) => {
      if (!ev.path.endsWith('parallel.md')) return;
      active++;
      maxConcurrent = Math.max(maxConcurrent, active);
      totalCalls++;
      // Simulate a slow ingest to maximize the chance of overlap
      await sleep(100);
      active--;
      c.events.push(ev);
    });
    await sleep(50);
    c.events.length = 0;
    totalCalls = 0;

    // Fire 3 rapid writes to the same file. Without debounce there'd be 3
    // handler calls; with debounce there's 1.
    writeFileSync(file, '# v1');
    writeFileSync(file, '# v2');
    writeFileSync(file, '# v3');
    await sleep(300); // wait for debounce + handler to run

    expect(totalCalls).toBe(1);
    expect(maxConcurrent).toBeLessThanOrEqual(1);
  });
});

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
