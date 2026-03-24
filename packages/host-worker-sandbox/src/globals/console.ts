import type { Logger } from '@novasamatech/host-api';
import type { QuickJSContext } from 'quickjs-emscripten';

export function injectConsole(vm: QuickJSContext, logger: Logger) {
  const consoleObj = vm.newObject();
  for (const method of ['log', 'info', 'warn', 'error'] as const) {
    const fn = vm.newFunction(method, (...args) => {
      logger[method](...args.map(h => vm.dump(h)));
      return vm.undefined;
    });
    vm.setProp(consoleObj, method, fn);
    fn.dispose();
  }
  vm.setProp(vm.global, 'console', consoleObj);
  consoleObj.dispose();
}
