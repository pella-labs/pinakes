import { resolve } from 'node:path';

import chokidar, { type FSWatcher } from 'chokidar';

import { logger } from '../observability/logger.js';
import type { IngestEvent, IngestEventKind, IngestSource, Scope } from './source.js';

/**
 * `ChokidarWatcher` — file-system implementation of `IngestSource` for KG-MCP Phase 2.
 *
 * Watches a wiki directory recursively for `*.md` changes, with the two
 * critical adaptations for Pharos's wiki-updater (CLAUDE.md §Database Rules #4,
 * §Architecture #3, Loop 6.5 A4):
 *
 * **2-second debounce per path** (NOT chokidar's default 50ms). The
 * wiki-updater writes via atomic rename, which fires chokidar events in
 * rapid bursts (`add` immediately followed by `change` from a follow-up
 * write to the same file). A 50ms debounce coalesces some of these but
 * misses the longer-tail bursts where the wiki-updater appends to log.md
 * a few hundred milliseconds after the initial atomic rename. 2 seconds
 * is the empirically-derived sweet spot.
 *
 * **Bounded queue with drop-oldest per source path**. If 3 events arrive
 * for the same file before the 2s timer fires, only the latest event is
 * dispatched. Earlier events are silently dropped. This is correct
 * because each event represents the *current* state of the file — older
 * events are already obsolete by the time we'd ingest them.
 *
 * **Initial scan**: chokidar emits `add` events for every existing file
 * during its first pass (when `ignoreInitial: false`). These are dispatched
 * just like change events, so a fresh `serve` start will trigger the
 * ingester for every wiki file. The ingester's manifest fast-path
 * (source_sha unchanged → noop) makes this cheap on warm starts.
 */

const DEBOUNCE_MS = 2_000;

export interface ChokidarWatcherOptions {
  /** Absolute path to the wiki root directory */
  rootDir: string;
  /** Which scope to tag events with */
  scope: Scope;
  /** Override debounce window — tests use this with fake timers */
  debounceMs?: number;
}

/**
 * One queued event per source path. The map's value is the latest event
 * (drop-oldest semantics), and the timer fires `debounceMs` after the
 * FIRST event for that path arrives. Subsequent events within the window
 * overwrite the value but DON'T reset the timer — that way a steady stream
 * of writes still gets ingested every `debounceMs`, instead of being
 * starved indefinitely.
 */
interface PendingEvent {
  event: IngestEvent;
  timer: NodeJS.Timeout;
}

export class ChokidarWatcher implements IngestSource {
  private watcher: FSWatcher | null = null;
  private pending: Map<string, PendingEvent> = new Map();
  private readonly debounceMs: number;
  private onEvent: ((ev: IngestEvent) => Promise<void>) | null = null;

  constructor(private readonly options: ChokidarWatcherOptions) {
    this.debounceMs = options.debounceMs ?? DEBOUNCE_MS;
  }

  async start(onEvent: (ev: IngestEvent) => Promise<void>): Promise<void> {
    if (this.watcher) {
      throw new Error('ChokidarWatcher.start called twice');
    }
    this.onEvent = onEvent;

    const root = resolve(this.options.rootDir);

    // Note: chokidar 4.x removed glob support — pass the root directory
    // and filter paths in the event handlers. We deliberately do NOT use
    // the `ignored` option here because in chokidar 4.x it's matched against
    // every traversed path including the root directory itself, and a naive
    // "not .md → ignore" check ignores the wiki dir before recursing into it.
    // Filtering inside the per-event handlers is simpler and bug-free.
    this.watcher = chokidar.watch(root, {
      ignoreInitial: false,
      // No awaitWriteFinish — we have our own debounce that's better-suited
      // to the wiki-updater's atomic-rename pattern.
      awaitWriteFinish: false,
    });

    const isMarkdown = (path: string): boolean => path.toLowerCase().endsWith('.md');

    this.watcher.on('add', (path) => {
      if (isMarkdown(path)) this.queueEvent('file:added', path);
    });
    this.watcher.on('change', (path) => {
      if (isMarkdown(path)) this.queueEvent('file:changed', path);
    });
    this.watcher.on('unlink', (path) => {
      if (isMarkdown(path)) this.queueEvent('file:removed', path);
    });
    this.watcher.on('error', (err) => {
      logger.error({ err, root }, 'chokidar error');
    });

    // Wait for the initial scan to complete so callers know all `add` events
    // have been queued before start() resolves. chokidar emits `ready` once
    // the initial scan finishes.
    await new Promise<void>((resolveWait) => {
      this.watcher!.once('ready', () => resolveWait());
    });
  }

  async stop(): Promise<void> {
    // Cancel every pending debounce timer so we don't fire after stop.
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
    }
    this.pending.clear();

    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
    }
    this.onEvent = null;
  }

  /**
   * Test-only: dispatch all pending events immediately, bypassing the
   * debounce timer. Used by chokidar.test.ts so the test doesn't have to
   * wait 2 real seconds.
   */
  async __flushForTests(): Promise<void> {
    const entries = Array.from(this.pending.entries());
    this.pending.clear();
    for (const [, pending] of entries) {
      clearTimeout(pending.timer);
      await this.dispatch(pending.event);
    }
  }

  /**
   * Test-only: number of currently-queued events. Used to assert
   * drop-oldest semantics.
   */
  __pendingCountForTests(): number {
    return this.pending.size;
  }

  private queueEvent(kind: IngestEventKind, path: string): void {
    const abs = resolve(path);
    const event: IngestEvent = { kind, path: abs, scope: this.options.scope };

    const existing = this.pending.get(abs);
    if (existing) {
      // Drop-oldest: replace the queued event but DON'T restart the timer.
      // This caps a single file's queue depth at 1 even under heavy load,
      // and bounds the worst-case latency to `debounceMs` after the first
      // event in a burst.
      existing.event = event;
      return;
    }

    // First event for this path — start a fresh debounce timer.
    const timer = setTimeout(() => {
      const pending = this.pending.get(abs);
      this.pending.delete(abs);
      if (pending) {
        // Fire-and-forget: dispatch errors are logged inside dispatch().
        // We don't await here because the chokidar event loop must keep
        // pumping new events; the ingester's single-flight gate handles
        // concurrent dispatches for the same path.
        void this.dispatch(pending.event);
      }
    }, this.debounceMs);

    this.pending.set(abs, { event, timer });
  }

  private async dispatch(event: IngestEvent): Promise<void> {
    if (!this.onEvent) return;
    try {
      await this.onEvent(event);
    } catch (err) {
      logger.error({ err, event }, 'ingest event handler failed');
    }
  }
}
