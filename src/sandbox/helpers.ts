import type {
  QuickJSContext,
  QuickJSHandle,
  QuickJSRuntime,
} from 'quickjs-emscripten';

/**
 * Shared helpers for the QuickJS sandbox. Extracted from executor.ts in
 * Phase 3 so both the legacy flat-binding path and the new nested-binding
 * path can reuse them.
 */

// ============================================================================
// Bootstrap: disabled globals
// ============================================================================

export const DISABLE_GLOBALS_BOOTSTRAP = `
(() => {
  const ban = (name) => {
    try { delete globalThis[name]; } catch (_) {}
    try {
      Object.defineProperty(globalThis, name, {
        get() { throw new Error(name + ' is not available in the pinakes sandbox'); },
        configurable: false,
      });
    } catch (_) {}
  };
  ban('eval');
  ban('Function');
  ban('fetch');
  ban('require');
  ban('process');
  ban('WebAssembly');
  try {
    Object.defineProperty(globalThis, 'constructor', {
      get() { throw new Error('constructor is not available in the pinakes sandbox'); },
      configurable: false,
    });
  } catch (_) {}
})();
`;

// ============================================================================
// Pending-jobs drain
// ============================================================================

/**
 * Pump the pending-jobs queue until it's drained or the runtime rejects
 * further work. Our async IIFE's microtasks all live in this queue, so a
 * single pass is usually enough — but nested `Promise.then` chains can
 * require multiple passes. Bounded at 32 iterations to avoid spinning
 * forever on runaway code (the interrupt handler is the real safety net).
 */
export function drainPendingJobs(runtime: QuickJSRuntime): void {
  for (let i = 0; i < 32; i++) {
    const result = runtime.executePendingJobs();
    if (result.error) {
      result.error.dispose();
      return;
    }
    if (result.value <= 0) return;
  }
}

// ============================================================================
// Host-value marshaling
// ============================================================================

/**
 * Convert a plain JS value into a QuickJSHandle that the guest can see.
 * Handles primitives, arrays, and plain objects recursively. The caller is
 * NOT responsible for disposing the returned handle — QuickJS's function
 * return mechanism transfers ownership into the guest VM.
 */
export function marshalJsValue(context: QuickJSContext, value: unknown): QuickJSHandle {
  if (value === undefined) return context.undefined;
  if (value === null) return context.null;
  if (typeof value === 'string') return context.newString(value);
  if (typeof value === 'number') return context.newNumber(value);
  if (typeof value === 'boolean') return value ? context.true : context.false;
  if (typeof value === 'bigint') return context.newNumber(Number(value));
  if (Array.isArray(value)) {
    const arr = context.newArray();
    for (let i = 0; i < value.length; i++) {
      const elem = marshalJsValue(context, value[i]);
      context.setProp(arr, i, elem);
      elem.dispose();
    }
    return arr;
  }
  if (typeof value === 'object') {
    const obj = context.newObject();
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const elem = marshalJsValue(context, v);
      context.setProp(obj, k, elem);
      elem.dispose();
    }
    return obj;
  }
  // Fallback: stringify unknowns. Covers symbols, functions, etc.
  return context.newString(String(value));
}

// ============================================================================
// Error helpers
// ============================================================================

export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === 'string') return e;
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}

export function formatGuestError(dumped: unknown): string {
  if (dumped && typeof dumped === 'object') {
    const obj = dumped as { name?: string; message?: string; stack?: string };
    const parts: string[] = [];
    if (obj.name) parts.push(String(obj.name));
    if (obj.message) parts.push(String(obj.message));
    if (parts.length > 0) return parts.join(': ');
  }
  return typeof dumped === 'string' ? dumped : JSON.stringify(dumped);
}

export function isPromise(value: unknown): value is Promise<unknown> {
  return (
    value !== null &&
    (typeof value === 'object' || typeof value === 'function') &&
    typeof (value as { then?: unknown }).then === 'function'
  );
}
