import {
  getQuickJS,
  Scope,
  type QuickJSContext,
  type QuickJSHandle,
  type QuickJSRuntime,
  type QuickJSWASMModule,
} from 'quickjs-emscripten';

import {
  normalizeCode,
  type ExecuteResult,
  type Executor,
  type ResolvedProvider,
} from './vendored-codemode.js';

import {
  DISABLE_GLOBALS_BOOTSTRAP,
  drainPendingJobs,
  errorMessage,
  formatGuestError,
  isPromise,
  marshalJsValue,
} from './helpers.js';

import { SandboxPool, type PoolStats } from './pool.js';
import { installBindings, type BindingDeps } from './bindings/install.js';

/**
 * QuickJS-backed Executor.
 *
 * Phase 3 upgrade: warm pool N=2 + `executeWithBindings()` for the full
 * `kg.project.*` binding surface. The legacy `execute()` path (flat
 * providers) remains for backward compatibility with Phase 1/2 tests.
 *
 * **Pool path** (`executeWithBindings`):
 *   1. Acquire a runtime from the warm pool (or cold-spawn on overflow)
 *   2. Create a fresh context on the pooled runtime
 *   3. Bootstrap disabled globals + install full bindings
 *   4. Evaluate normalized code
 *   5. Dispose context, release runtime back to pool
 *
 * **Legacy path** (`execute`):
 *   Fresh runtime + context per call, flat provider injection.
 *   Kept for Phase 1/2 spike tests that use `kg.search`/`kg.get` directly.
 *
 * Error handling is always in-payload (CLAUDE.md §API Rules #8).
 */

export interface QuickJSExecutorOptions {
  /** Memory limit in bytes. Defaults to 64 MB per `KG_MAX_MEMORY_MB`. */
  memoryLimitBytes?: number;
  /**
   * Execution deadline in ms. The interrupt handler fires after this much
   * wall-clock time. Defaults to 2000; clamped to `maxTimeoutMs`.
   */
  timeoutMs?: number;
  /**
   * Hard ceiling on `timeoutMs` from tool-call params. Defaults to 10_000
   * per `KG_MAX_TIMEOUT_MS`. Callers cannot set `timeoutMs` above this.
   */
  maxTimeoutMs?: number;
  /** Warm pool size. Defaults to 2. */
  poolSize?: number;
}

const DEFAULT_MEMORY_LIMIT = 64 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 2000;
const DEFAULT_MAX_TIMEOUT_MS = 10_000;

/** Error patterns that indicate the QuickJS runtime is compromised. */
const CRASH_PATTERNS = ['out of memory', 'allocation failed', 'stack overflow'];

export class QuickJSExecutor implements Executor {
  private wasmModule: QuickJSWASMModule | null = null;
  private pool: SandboxPool | null = null;
  private readonly memoryLimitBytes: number;
  private readonly defaultTimeoutMs: number;
  private readonly maxTimeoutMs: number;
  private readonly poolSize: number;

  constructor(options: QuickJSExecutorOptions = {}) {
    this.memoryLimitBytes = options.memoryLimitBytes ?? DEFAULT_MEMORY_LIMIT;
    this.defaultTimeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxTimeoutMs = options.maxTimeoutMs ?? DEFAULT_MAX_TIMEOUT_MS;
    this.poolSize = options.poolSize ?? 2;
  }

  /**
   * Warm the cached WASM module and initialize the pool. Safe to call
   * multiple times.
   */
  async warmup(): Promise<void> {
    if (!this.wasmModule) {
      this.wasmModule = await getQuickJS();
    }
    if (!this.pool) {
      this.pool = new SandboxPool(this.wasmModule, {
        poolSize: this.poolSize,
        memoryLimitBytes: this.memoryLimitBytes,
      });
    }
  }

  /**
   * Phase 3 primary path: execute code with the full `kg.project.*`
   * bindings, `budget.fit()`, and `logger.log()` installed via the pool.
   */
  async executeWithBindings(
    code: string,
    deps: BindingDeps,
    timeoutMs?: number
  ): Promise<ExecuteResult> {
    await this.warmup();
    const pool = this.pool!;

    let wrapped: string;
    try {
      wrapped = normalizeCode(code);
    } catch (e) {
      return { result: null, error: `normalizeCode failed: ${errorMessage(e)}` };
    }

    const effectiveTimeout = Math.min(
      timeoutMs ?? this.defaultTimeoutMs,
      this.maxTimeoutMs
    );

    const pr = pool.acquire();
    let context: QuickJSContext | null = null;
    let crashed = false;

    try {
      const deadline = Date.now() + effectiveTimeout;
      pr.runtime.setInterruptHandler(() => Date.now() > deadline);

      context = pr.runtime.newContext();

      // Bootstrap disabled globals
      const disableResult = context.evalCode(DISABLE_GLOBALS_BOOTSTRAP);
      if (disableResult.error) {
        const err = context.dump(disableResult.error);
        disableResult.error.dispose();
        return { result: null, error: `bootstrap failed: ${JSON.stringify(err)}`, logs: deps.logs };
      }
      disableResult.value.dispose();

      // Install all bindings (logger, kg.project.*, budget.fit)
      installBindings(context, deps);

      // Evaluate the wrapped code
      const callSource = `(${wrapped})()`;
      const evalResult = context.evalCode(callSource, 'kg_execute.js');
      if (evalResult.error) {
        const err = context.dump(evalResult.error);
        evalResult.error.dispose();
        return { result: null, error: formatGuestError(err), logs: deps.logs };
      }

      const promiseHandle = evalResult.value;
      try {
        drainPendingJobs(pr.runtime);
        const state = context.getPromiseState(promiseHandle);
        if (state.type === 'pending') {
          return {
            result: null,
            error: 'kg_execute Promise never settled — all host bindings are synchronous',
            logs: deps.logs,
          };
        }
        if (state.type === 'rejected') {
          try {
            const err = context.dump(state.error);
            return { result: null, error: formatGuestError(err), logs: deps.logs };
          } finally {
            state.error.dispose();
          }
        }
        try {
          const value = context.dump(state.value);
          return { result: value, logs: deps.logs };
        } finally {
          state.value.dispose();
        }
      } finally {
        promiseHandle.dispose();
      }
    } catch (e) {
      const msg = errorMessage(e);
      crashed = isCrash(msg);
      return { result: null, error: msg, logs: deps.logs };
    } finally {
      context?.dispose();
      pool.release(pr, crashed);
    }
  }

  /** Pool stats for instrumentation / tests. */
  getPoolStats(): PoolStats | null {
    return this.pool?.getStats() ?? null;
  }

  /** Dispose the pool and release all runtimes. */
  dispose(): void {
    this.pool?.dispose();
    this.pool = null;
  }

  // ==========================================================================
  // Legacy path — backward compat for Phase 1/2 spike tests
  // ==========================================================================

  /**
   * Execute LLM-generated JS with flat provider injection (Phase 1/2 path).
   * Creates a fresh runtime + context per call. Kept for backward compat.
   */
  async execute(
    code: string,
    providersOrFns:
      | ResolvedProvider[]
      | Record<string, (...args: unknown[]) => Promise<unknown>>
  ): Promise<ExecuteResult> {
    await this.warmup();
    const wasmModule = this.wasmModule!;

    let wrapped: string;
    try {
      wrapped = normalizeCode(code);
    } catch (e) {
      return { result: null, error: `normalizeCode failed: ${errorMessage(e)}` };
    }

    const logs: string[] = [];
    const timeoutMs = Math.min(this.defaultTimeoutMs, this.maxTimeoutMs);

    let runtime: QuickJSRuntime | null = null;
    let context: QuickJSContext | null = null;
    try {
      runtime = wasmModule.newRuntime();
      runtime.setMemoryLimit(this.memoryLimitBytes);

      const deadline = Date.now() + timeoutMs;
      runtime.setInterruptHandler(() => Date.now() > deadline);

      context = runtime.newContext();

      const disableResult = context.evalCode(DISABLE_GLOBALS_BOOTSTRAP);
      if (disableResult.error) {
        const err = context.dump(disableResult.error);
        disableResult.error.dispose();
        return { result: null, error: `bootstrap failed: ${JSON.stringify(err)}`, logs };
      }
      disableResult.value.dispose();

      installLegacyLogger(context, logs);
      installProviders(context, providersOrFns);

      const callSource = `(${wrapped})()`;
      const evalResult = context.evalCode(callSource, 'kg_execute.js');
      if (evalResult.error) {
        const err = context.dump(evalResult.error);
        evalResult.error.dispose();
        return { result: null, error: formatGuestError(err), logs };
      }

      const promiseHandle = evalResult.value;
      try {
        drainPendingJobs(runtime);
        const state = context.getPromiseState(promiseHandle);
        if (state.type === 'pending') {
          return {
            result: null,
            error: 'kg_execute Promise never settled — async host bindings are not supported',
            logs,
          };
        }
        if (state.type === 'rejected') {
          try {
            const err = context.dump(state.error);
            return { result: null, error: formatGuestError(err), logs };
          } finally {
            state.error.dispose();
          }
        }
        try {
          const value = context.dump(state.value);
          return { result: value, logs };
        } finally {
          state.value.dispose();
        }
      } finally {
        promiseHandle.dispose();
      }
    } catch (e) {
      return { result: null, error: errorMessage(e), logs };
    } finally {
      context?.dispose();
      runtime?.dispose();
    }
  }
}

// ============================================================================
// Crash detection
// ============================================================================

function isCrash(errorMsg: string): boolean {
  const lower = errorMsg.toLowerCase();
  return CRASH_PATTERNS.some((p) => lower.includes(p));
}

// ============================================================================
// Legacy logger (for execute() backward compat)
// ============================================================================

function installLegacyLogger(context: QuickJSContext, logs: string[]): void {
  Scope.withScope((scope) => {
    const loggerObj = scope.manage(context.newObject());

    const logFn = context.newFunction('log', (...argsHandles: QuickJSHandle[]) => {
      try {
        const parts: string[] = [];
        for (const h of argsHandles) {
          const dumped = context.dump(h);
          parts.push(typeof dumped === 'string' ? dumped : JSON.stringify(dumped));
        }
        logs.push(parts.join(' '));
      } catch (e) {
        logs.push(`<logger.log serialization error: ${errorMessage(e)}>`);
      }
      return context.undefined;
    });
    context.setProp(loggerObj, 'log', logFn);
    logFn.dispose();

    context.setProp(context.global, 'logger', loggerObj);
  });
}

// ============================================================================
// Legacy provider injection (for execute() backward compat)
// ============================================================================

function installProviders(
  context: QuickJSContext,
  providersOrFns:
    | ResolvedProvider[]
    | Record<string, (...args: unknown[]) => Promise<unknown>>
): void {
  const providers: ResolvedProvider[] = Array.isArray(providersOrFns)
    ? providersOrFns
    : [{ name: 'codemode', fns: providersOrFns }];

  for (const provider of providers) {
    Scope.withScope((scope) => {
      const nsObj = scope.manage(context.newObject());

      for (const [fnName, hostFn] of Object.entries(provider.fns)) {
        const wrapped = context.newFunction(fnName, (...argsHandles: QuickJSHandle[]) => {
          try {
            const nativeArgs = argsHandles.map((h) => context.dump(h));
            const rawResult = provider.positionalArgs
              ? (hostFn as (...args: unknown[]) => unknown)(...nativeArgs)
              : (hostFn as (arg: unknown) => unknown)(nativeArgs[0]);
            if (isPromise(rawResult)) {
              throw new Error(
                `host function ${provider.name}.${fnName} returned a Promise; ` +
                  'only synchronous host bindings are supported'
              );
            }
            return marshalJsValue(context, rawResult);
          } catch (e) {
            return context.newError(errorMessage(e));
          }
        });
        context.setProp(nsObj, fnName, wrapped);
        wrapped.dispose();
      }

      context.setProp(context.global, provider.name, nsObj);
    });
  }
}
