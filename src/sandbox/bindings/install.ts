import type { QuickJSContext } from 'quickjs-emscripten';

import { installLogger } from './logger.js';
import { installPinakesBindings, type PinakesBindingDeps } from './pinakes.js';
import { installBudgetBindings } from './budget.js';

/**
 * All deps needed by the binding surface. Supports single-scope
 * (project-only or personal-only) and dual-scope (both).
 *
 * Privacy invariant: if `personal` is undefined, `pinakes.personal`
 * does NOT exist in the sandbox — not undefined, not null, absent.
 */
export interface BindingDeps {
  project?: PinakesBindingDeps;
  personal?: PinakesBindingDeps;
  maxTokens: number;
  logs: string[];
}

/**
 * Install all sandbox bindings on a fresh QuickJS context:
 *   1. `logger.log(...)` capture
 *   2. `pinakes.project.*` and/or `pinakes.personal.*` (scope-dependent)
 *   3. `budget.fit()`
 */
export function installBindings(context: QuickJSContext, deps: BindingDeps): void {
  installLogger(context, deps.logs);
  installPinakesBindings(context, deps.project, deps.personal);
  installBudgetBindings(context, deps.maxTokens);
}
