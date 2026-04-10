import { Scope, type QuickJSContext, type QuickJSHandle } from 'quickjs-emscripten';
import { errorMessage } from '../helpers.js';

/**
 * Install `logger.log(...)` capture on a QuickJS context.
 *
 * Every call to `logger.log(arg1, arg2, ...)` inside the guest appends a
 * single string to `logs`. Arguments are dumped from QuickJS handles and
 * joined with spaces — strings pass through as-is, everything else is
 * JSON-stringified.
 */
export function installLogger(context: QuickJSContext, logs: string[]): void {
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
