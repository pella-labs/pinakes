/**
 * `IngestSource` interface for Pinakes Phase 2.
 *
 * The data-plane seam between the file-system watcher (chokidar today,
 * orchestrator message queue tomorrow) and the `IngesterService`.
 *
 * Phase 2 ships two implementations:
 *   - `ChokidarWatcher` (src/ingest/chokidar.ts) — watches a directory,
 *     emits events on file changes, with the mandatory 2-second debounce
 *     and per-path drop-oldest queue
 *   - `QueueSubscriber` (src/ingest/queue.ts) — stub that throws
 *     `not implemented`. Phase 5+ wires it to the orchestrator contract
 *     when that lands.
 *
 * The `ChokidarWatcher` ↔ `QueueSubscriber` swap is one line in
 * `src/cli/serve.ts`. Per presearch.md §2.5 / D19.
 */

export type IngestEventKind = 'file:added' | 'file:changed' | 'file:removed';

export type Scope = 'project' | 'personal';

export interface IngestEvent {
  /** What happened */
  kind: IngestEventKind;
  /** Absolute path to the markdown file */
  path: string;
  /** Which knowledge graph this event belongs to */
  scope: Scope;
}

/**
 * The interface that `serve.ts` programs against. The watcher (or queue
 * subscriber) calls `start(onEvent)` and pumps events into the callback;
 * `stop()` cleans up.
 *
 * Errors thrown by the `onEvent` callback are caught by the source and
 * logged — the source MUST NOT crash on a single failing event, since
 * a single corrupt file shouldn't bring down the watcher for an entire
 * wiki dir.
 */
export interface IngestSource {
  start(onEvent: (ev: IngestEvent) => Promise<void>): Promise<void>;
  stop(): Promise<void>;
}
