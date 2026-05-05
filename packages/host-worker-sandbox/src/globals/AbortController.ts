import type { QuickJSContext, QuickJSHandle } from 'quickjs-emscripten';

export function injectAbortController(vm: QuickJSContext) {
  const abortControllerCtor = vm.newConstructorFunction('AbortController', () => {
    const listeners: QuickJSHandle[] = [];
    let aborted = false;

    const signal = vm.newObject();
    vm.setProp(signal, 'aborted', vm.false);
    // Keep a host-side reference for use inside the abort closure and for
    // immediate-fire when addEventListener is called on an already-aborted signal.
    const signalRef = signal.dup();

    const addEventListener = vm.newFunction('addEventListener', (typeHandle, listenerHandle) => {
      if (vm.dump(typeHandle) !== 'abort') return vm.undefined;
      if (aborted) {
        // Spec: fire immediately when signal is already aborted.
        const res = vm.callFunction(listenerHandle, signalRef);
        if (res.error) res.error.dispose();
        else res.value.dispose();
      } else {
        listeners.push(listenerHandle.dup());
      }
      return vm.undefined;
    });

    const removeEventListener = vm.newFunction('removeEventListener', (typeHandle, listenerHandle) => {
      if (vm.dump(typeHandle) !== 'abort') return vm.undefined;
      // Compare by underlying JSValue pointer for function identity.
      const idx = listeners.findIndex(h => h.value === listenerHandle.value);
      if (idx !== -1) {
        const listener = listeners[idx];
        if (listener) {
          listener.dispose();
          listeners.splice(idx, 1);
        }
      }
      return vm.undefined;
    });

    vm.setProp(signal, 'addEventListener', addEventListener);
    vm.setProp(signal, 'removeEventListener', removeEventListener);
    addEventListener.dispose();
    removeEventListener.dispose();

    const instance = vm.newObject();

    const abortFn = vm.newFunction('abort', () => {
      if (aborted) return vm.undefined;
      aborted = true;
      vm.setProp(signalRef, 'aborted', vm.true);
      // Snapshot the list so re-entrant adds/removes don't affect this loop.
      const toCall = listeners.splice(0);
      for (const listener of toCall) {
        const res = vm.callFunction(listener, signalRef);
        if (res.error) res.error.dispose();
        else res.value.dispose();
        listener.dispose();
      }
      return vm.undefined;
    });

    vm.setProp(instance, 'signal', signal);
    vm.setProp(instance, 'abort', abortFn);

    signal.dispose();
    abortFn.dispose();

    return instance;
  });

  vm.setProp(vm.global, 'AbortController', abortControllerCtor);
  abortControllerCtor.dispose();
}
