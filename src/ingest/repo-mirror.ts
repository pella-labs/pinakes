import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';

import chokidar, { type FSWatcher } from 'chokidar';

import { loadIgnorePatterns, shouldIgnore, type IgnorePattern } from '../init/ignore.js';
import { logger } from '../observability/logger.js';

/**
 * `RepoMirrorWatcher` — one-way sync from project repo → wiki directory.
 *
 * Watches `<projectRoot>` for `.md` file changes outside `.pinakes/wiki/`,
 * and mirrors them into the wiki. The existing wiki `ChokidarWatcher` then
 * picks up the copied file and indexes it.
 *
 * Direction: repo → wiki only. Wiki-only files (no repo counterpart) are
 * never touched. Edits to mirrored files in the wiki will be overwritten
 * on the next repo-side change.
 */

const DEBOUNCE_MS = 2_000;

export interface RepoMirrorOptions {
  projectRoot: string;
  wikiRoot: string;
}

interface PendingMirror {
  kind: 'copy' | 'remove';
  sourcePath: string;
  timer: NodeJS.Timeout;
}

export class RepoMirrorWatcher {
  private watcher: FSWatcher | null = null;
  private pending: Map<string, PendingMirror> = new Map();
  private readonly projectRoot: string;
  private readonly wikiRoot: string;
  private readonly ignorePatterns: IgnorePattern[];

  constructor(opts: RepoMirrorOptions) {
    this.projectRoot = resolve(opts.projectRoot);
    this.wikiRoot = resolve(opts.wikiRoot);
    this.ignorePatterns = loadIgnorePatterns(this.projectRoot);
  }

  async start(): Promise<void> {
    if (this.watcher) throw new Error('RepoMirrorWatcher.start called twice');

    // Note: chokidar 4.x removed glob support for `ignored`. We filter
    // in the event handlers instead, matching the pattern used by
    // ChokidarWatcher (see chokidar.ts comment about this).
    this.watcher = chokidar.watch(this.projectRoot, {
      ignoreInitial: true,
      awaitWriteFinish: false,
    });

    const SKIP_DIRS = new Set([
      'node_modules', '.git', '.pinakes', 'dist', 'build', 'coverage',
      '.next', '.nuxt', 'vendor', '__pycache__', '.tox', 'target',
    ]);

    const shouldMirror = (path: string): boolean => {
      if (!path.toLowerCase().endsWith('.md')) return false;
      const abs = resolve(path);
      // Never mirror files already inside the wiki (prevents recursive nesting)
      if (abs.startsWith(this.wikiRoot + '/') || abs === this.wikiRoot) return false;
      const rel = relative(this.projectRoot, abs);
      // Skip files under excluded directories
      const segments = rel.split('/');
      for (const seg of segments.slice(0, -1)) {
        if (SKIP_DIRS.has(seg)) return false;
      }
      return !shouldIgnore(rel, this.ignorePatterns);
    };

    this.watcher.on('add', (path) => {
      if (shouldMirror(path)) this.queueMirror('copy', path);
    });
    this.watcher.on('change', (path) => {
      if (shouldMirror(path)) this.queueMirror('copy', path);
    });
    this.watcher.on('unlink', (path) => {
      if (shouldMirror(path)) this.queueMirror('remove', path);
    });
    this.watcher.on('error', (err) => {
      logger.error({ err }, 'repo mirror watcher error');
    });

    await new Promise<void>((resolveWait) => {
      this.watcher!.once('ready', () => resolveWait());
    });

    logger.info({ projectRoot: this.projectRoot }, 'repo mirror watcher started');
  }

  async stop(): Promise<void> {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
    }
    this.pending.clear();

    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
    }
  }

  private queueMirror(kind: 'copy' | 'remove', sourcePath: string): void {
    const abs = resolve(sourcePath);
    const existing = this.pending.get(abs);
    if (existing) {
      existing.kind = kind;
      existing.sourcePath = abs;
      return;
    }

    const timer = setTimeout(() => {
      const pending = this.pending.get(abs);
      this.pending.delete(abs);
      if (pending) {
        this.executeMirror(pending);
      }
    }, DEBOUNCE_MS);

    this.pending.set(abs, { kind, sourcePath: abs, timer });
  }

  private executeMirror(pending: PendingMirror): void {
    const rel = relative(this.projectRoot, pending.sourcePath);
    if (rel.startsWith('..')) return; // safety

    const target = resolve(this.wikiRoot, rel);

    try {
      if (pending.kind === 'copy') {
        mkdirSync(dirname(target), { recursive: true });
        cpSync(pending.sourcePath, target);
        logger.debug({ source: pending.sourcePath, target }, 'repo mirror: copied');
      } else if (pending.kind === 'remove' && existsSync(target)) {
        rmSync(target);
        logger.debug({ target }, 'repo mirror: removed');
      }
    } catch (err) {
      logger.warn({ err, source: pending.sourcePath, target }, 'repo mirror: operation failed');
    }
  }
}
