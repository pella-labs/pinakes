import type { Database as BetterSqliteDatabase } from 'better-sqlite3';

import { crystallizeCommand, getGitHead } from './crystallize.js';
import { createLlmProvider } from '../llm/provider.js';
import { logger } from '../observability/logger.js';

/**
 * CrystallizationScheduler — autonomous wiki evolution via three trigger layers.
 *
 * Runs inside the `pinakes serve` process and automatically distills coding
 * sessions into wiki pages without human intervention. The existing confidence
 * scoring, decay, contradiction detection, and supersession systems serve as
 * quality controls.
 *
 * **Trigger layers**:
 *   1. **Startup catch-up** — on construction, compare stored HEAD against
 *      current HEAD. If different, crystallize un-captured commits.
 *   2. **Commit poll** — check `git rev-parse HEAD` every 60s. If HEAD
 *      changed since last poll, trigger crystallization.
 *   3. **Time fallback** — every 4 hours, trigger crystallization regardless
 *      of HEAD changes. Catches solo devs who don't commit often.
 *
 * **Rate limit**: at most once per hour. Stored in `pinakes_meta` as
 * `last_crystallize_ts` and `last_crystallize_head`.
 *
 * **Graceful degradation**: skips silently if no LLM provider is available
 * or if the project is not a git repo.
 */

const RATE_LIMIT_MS = 60 * 60 * 1000;       // 1 hour
const COMMIT_POLL_MS = 60 * 1000;            // 60 seconds
const TIME_FALLBACK_MS = 4 * 60 * 60 * 1000; // 4 hours

const META_KEY_TS = 'last_crystallize_ts';
const META_KEY_HEAD = 'last_crystallize_head';

export class CrystallizationScheduler {
  private commitPollTimer: ReturnType<typeof setInterval> | null = null;
  private timeFallbackTimer: ReturnType<typeof setInterval> | null = null;
  private lastKnownHead: string | null = null;
  private running = false;

  constructor(
    private readonly projectRoot: string,
    private readonly writer: BetterSqliteDatabase,
  ) {}

  /**
   * Start all three trigger layers. Call once after server is ready.
   */
  start(): void {
    // 1. Startup catch-up
    this.lastKnownHead = getGitHead(this.projectRoot);
    if (this.lastKnownHead) {
      const storedHead = this.getMetaValue(META_KEY_HEAD);
      if (storedHead !== this.lastKnownHead) {
        logger.info(
          { storedHead, currentHead: this.lastKnownHead },
          'crystallize: startup catch-up — HEAD changed since last run',
        );
        void this.tryRun('startup');
      }
    }

    // 2. Commit poll (every 60s)
    this.commitPollTimer = setInterval(() => {
      this.pollCommit();
    }, COMMIT_POLL_MS);
    this.commitPollTimer.unref();

    // 3. Time fallback (every 4h)
    this.timeFallbackTimer = setInterval(() => {
      void this.tryRun('time-fallback');
    }, TIME_FALLBACK_MS);
    this.timeFallbackTimer.unref();

    logger.info('crystallize scheduler started (commit poll + time fallback)');
  }

  /**
   * Stop all timers. Called during graceful shutdown.
   */
  stop(): void {
    if (this.commitPollTimer) {
      clearInterval(this.commitPollTimer);
      this.commitPollTimer = null;
    }
    if (this.timeFallbackTimer) {
      clearInterval(this.timeFallbackTimer);
      this.timeFallbackTimer = null;
    }
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private pollCommit(): void {
    const head = getGitHead(this.projectRoot);
    if (!head) return; // not a git repo

    if (this.lastKnownHead === null) {
      this.lastKnownHead = head;
      return;
    }

    if (head !== this.lastKnownHead) {
      this.lastKnownHead = head;
      logger.info({ head }, 'crystallize: new commit detected');
      void this.tryRun('commit');
    }
  }

  private async tryRun(trigger: string): Promise<void> {
    if (this.running) return;
    if (!this.isRateLimitClear()) {
      logger.debug({ trigger }, 'crystallize: rate-limited, skipping');
      return;
    }

    this.running = true;
    try {
      const llm = createLlmProvider();
      if (!llm.available()) {
        logger.debug('crystallize: no LLM provider available, skipping');
        return;
      }

      logger.info({ trigger }, 'crystallize: running auto-crystallization');
      const result = await crystallizeCommand({
        projectRoot: this.projectRoot,
        llmProvider: llm,
      });

      if (result.skipped_reason) {
        logger.info({ trigger, reason: result.skipped_reason }, 'crystallize: skipped');
      } else {
        logger.info(
          { trigger, drafts: result.drafts_created },
          'crystallize: completed',
        );
      }

      // Update meta regardless of outcome (rate limit resets)
      this.setMetaValue(META_KEY_TS, String(Date.now()));
      const head = getGitHead(this.projectRoot);
      if (head) {
        this.setMetaValue(META_KEY_HEAD, head);
      }
    } catch (err) {
      logger.warn({ err, trigger }, 'crystallize: auto-crystallization failed');
    } finally {
      this.running = false;
    }
  }

  private isRateLimitClear(): boolean {
    const lastTs = this.getMetaValue(META_KEY_TS);
    if (!lastTs) return true;
    return Date.now() - parseInt(lastTs, 10) >= RATE_LIMIT_MS;
  }

  private getMetaValue(key: string): string | undefined {
    try {
      const row = this.writer
        .prepare(`SELECT value FROM pinakes_meta WHERE key = ?`)
        .get(key) as { value: string } | undefined;
      return row?.value;
    } catch {
      return undefined;
    }
  }

  private setMetaValue(key: string, value: string): void {
    try {
      this.writer
        .prepare(`INSERT OR REPLACE INTO pinakes_meta (key, value) VALUES (?, ?)`)
        .run(key, value);
    } catch (err) {
      logger.warn({ err, key }, 'crystallize: failed to write meta value');
    }
  }
}
