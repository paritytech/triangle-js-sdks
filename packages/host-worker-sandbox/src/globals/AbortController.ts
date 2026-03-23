import type { QuickJSContext } from 'quickjs-emscripten';

export function injectAbortController(vm: QuickJSContext) {
  const abortControllerCtor = vm.newConstructorFunction('AbortController', () => {
    const signal = vm.newObject();
    const addEventListener = vm.newFunction('addEventListener', () => vm.undefined);
    const removeEventListener = vm.newFunction('removeEventListener', () => vm.undefined);

    vm.setProp(signal, 'addEventListener', addEventListener);
    vm.setProp(signal, 'removeEventListener', removeEventListener);

    const instance = vm.newObject();
    vm.setProp(instance, 'signal', signal);

    signal.dispose();
    addEventListener.dispose();
    removeEventListener.dispose();
    return instance;
  });

  vm.setProp(vm.global, 'AbortController', abortControllerCtor);
  abortControllerCtor.dispose();
}
