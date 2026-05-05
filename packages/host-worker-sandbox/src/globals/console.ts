import type { Logger } from '@novasamatech/host-api';
import type { QuickJSContext } from 'quickjs-emscripten';

// Apply WHATWG console format specifiers to the first arg if it's a string
// containing `%` substitutions. Returns the new arg list with the substituted
// string prefixed and any unconsumed args appended.
//
// Spec: https://console.spec.whatwg.org/#formatter
function formatArgs(args: unknown[]): unknown[] {
  if (args.length === 0 || typeof args[0] !== 'string') return args;
  const fmt = args[0];
  if (!fmt.includes('%')) return args;

  let argIdx = 1;
  const formatted = fmt.replace(/%[sdifoOc%]/g, match => {
    if (match === '%%') return '%';
    if (argIdx >= args.length) return match;
    const arg = args[argIdx++];
    switch (match) {
      case '%s':
        return typeof arg === 'string' ? arg : String(arg);
      case '%d':
      case '%i': {
        const n = Number(arg);
        return Number.isFinite(n) ? String(Math.trunc(n)) : 'NaN';
      }
      case '%f':
        return String(Number(arg));
      case '%o':
      case '%O':
        try {
          return JSON.stringify(arg);
        } catch {
          return String(arg);
        }
      case '%c':
        // CSS styling — not applicable to a logger sink, drop the directive.
        return '';
      default:
        return match;
    }
  });
  return [formatted, ...args.slice(argIdx)];
}

export function injectConsole(vm: QuickJSContext, logger: Logger) {
  const consoleObj = vm.newObject();
  for (const method of ['log', 'info', 'warn', 'error'] as const) {
    const fn = vm.newFunction(method, (...args) => {
      const dumped = args.map(h => vm.dump(h));
      logger[method](...formatArgs(dumped));
      return vm.undefined;
    });
    vm.setProp(consoleObj, method, fn);
    fn.dispose();
  }
  vm.setProp(vm.global, 'console', consoleObj);
  consoleObj.dispose();
}
