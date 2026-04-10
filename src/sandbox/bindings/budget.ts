import type { QuickJSContext, QuickJSHandle } from 'quickjs-emscripten';
import { Scope } from 'quickjs-emscripten';

import { fitResults } from '../../gate/budget.js';
import { errorMessage, marshalJsValue } from '../helpers.js';

/**
 * Install the `budget` global with a `fit(items, maxTokens)` method.
 *
 * `budget.fit()` is a host-backed function: guest code passes an array of
 * items and a token budget, the host runs the real `fitResults()` with
 * js-tiktoken, and the truncated array is returned to the guest.
 */
export function installBudgetBindings(context: QuickJSContext, maxTokens: number): void {
  Scope.withScope((scope) => {
    const budgetObj = scope.manage(context.newObject());

    const fitFn = context.newFunction('fit', (...handles: QuickJSHandle[]) => {
      try {
        const items = handles[0] ? context.dump(handles[0]) : [];
        if (!Array.isArray(items)) {
          return context.newError('budget.fit: first argument must be an array');
        }
        const budget = typeof handles[1] !== 'undefined'
          ? (context.dump(handles[1]) as number)
          : maxTokens;

        let idx = 0;
        const result = fitResults<unknown>(
          items,
          budget,
          (item) => JSON.stringify(item),
          (item) => {
            const obj = item as { id?: unknown } | null;
            if (obj && typeof obj.id === 'string') return obj.id;
            return `[${idx++}]`;
          },
          (item) => {
            const obj = item as { source_uri?: unknown } | null;
            return obj && typeof obj.source_uri === 'string' ? obj.source_uri : '';
          }
        );

        return marshalJsValue(context, result.kept);
      } catch (e) {
        return context.newError(errorMessage(e));
      }
    });

    context.setProp(budgetObj, 'fit', fitFn);
    fitFn.dispose();

    context.setProp(context.global, 'budget', budgetObj);
  });
}
