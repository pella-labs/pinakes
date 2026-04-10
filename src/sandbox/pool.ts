import type { QuickJSRuntime, QuickJSWASMModule } from 'quickjs-emscripten';

/**
 * Warm sandbox pool (presearch D12, CLAUDE.md §Architecture #1).
 *
 * Manages a pool of N pre-created QuickJS runtimes with synchronous
 * acquire/release semantics. Each runtime has its memory limit pre-set;
 * callers create fresh contexts on the acquired runtime, run code, dispose
 * the context, then release the runtime back.
 *
 * **Overflow**: when all N runtimes are checked out, `acquire()` spawns a
 * cold runtime on the spot — it never blocks. Cold overflow runtimes are
 * disposed on release (the pool never grows beyond `maxSize`).
 *
 * **Crash recovery**: if the caller signals `crashed=true` on release, the
 * runtime is disposed and a fresh replacement is created so the pool stays
 * at its target size. This handles QuickJS OOM or WASM-level failures that
 * leave the runtime in an inconsistent state.
 *
 * **Instrumentation**: `getStats()` reports warm hits, cold hits, and crash
 * counts for the Phase 3 test suite.
 */

export interface PoolStats {
  warmHits: number;
  coldHits: number;
  crashes: number;
  currentSize: number;
}

export interface PooledRuntime {
  runtime: QuickJSRuntime;
  /** Monotonic id for instrumentation / test assertions. */
  id: number;
  /** True if this runtime came from the warm pool, false if overflow-spawned. */
  isWarm: boolean;
}

export class SandboxPool {
  private readonly available: PooledRuntime[] = [];
  private readonly maxSize: number;
  private readonly memoryLimitBytes: number;
  private readonly stats: PoolStats = {
    warmHits: 0,
    coldHits: 0,
    crashes: 0,
    currentSize: 0,
  };
  private nextId = 0;
  private disposed = false;

  constructor(
    private readonly wasmModule: QuickJSWASMModule,
    opts?: { poolSize?: number; memoryLimitBytes?: number }
  ) {
    this.maxSize = opts?.poolSize ?? 2;
    this.memoryLimitBytes = opts?.memoryLimitBytes ?? 64 * 1024 * 1024;

    // Pre-create warm runtimes.
    for (let i = 0; i < this.maxSize; i++) {
      this.available.push(this.spawnRuntime(true));
    }
    this.stats.currentSize = this.maxSize;
  }

  /**
   * Acquire a runtime from the pool. If the pool has warm runtimes available,
   * returns one immediately. Otherwise spawns a cold overflow runtime.
   * Never blocks.
   */
  acquire(): PooledRuntime {
    if (this.disposed) throw new Error('SandboxPool is disposed');

    const warm = this.available.pop();
    if (warm) {
      this.stats.warmHits++;
      return warm;
    }

    // Overflow — spawn cold runtime, don't grow the pool.
    this.stats.coldHits++;
    return this.spawnRuntime(false);
  }

  /**
   * Release a runtime back to the pool. If `crashed` is true, the runtime
   * is disposed and replaced with a fresh one. Overflow runtimes (not from
   * the warm pool) are always disposed on release.
   */
  release(pr: PooledRuntime, crashed: boolean): void {
    if (this.disposed) {
      // Pool is shutting down — just dispose.
      try { pr.runtime.dispose(); } catch { /* best effort */ }
      return;
    }

    if (crashed) {
      this.stats.crashes++;
      try { pr.runtime.dispose(); } catch { /* already dead */ }
      // Replace with a fresh runtime if this was a warm slot.
      if (pr.isWarm && this.available.length < this.maxSize) {
        this.available.push(this.spawnRuntime(true));
      }
      return;
    }

    // Return warm runtimes to pool; dispose overflow runtimes.
    if (pr.isWarm && this.available.length < this.maxSize) {
      this.available.push(pr);
    } else {
      try { pr.runtime.dispose(); } catch { /* best effort */ }
    }
  }

  getStats(): Readonly<PoolStats> {
    return { ...this.stats, currentSize: this.available.length };
  }

  dispose(): void {
    this.disposed = true;
    for (const pr of this.available) {
      try { pr.runtime.dispose(); } catch { /* best effort */ }
    }
    this.available.length = 0;
  }

  // --------------------------------------------------------------------------

  private spawnRuntime(isWarm: boolean): PooledRuntime {
    const runtime = this.wasmModule.newRuntime();
    runtime.setMemoryLimit(this.memoryLimitBytes);
    return { runtime, id: this.nextId++, isWarm };
  }
}
