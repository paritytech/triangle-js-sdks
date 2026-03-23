import type { Lifetime, QuickJSContext } from 'quickjs-emscripten';

export function injectTimeouts(vm: QuickJSContext): VoidFunction {
  const refs = new Map<number, Lifetime<any, any, any>>();
  let disposed = false;

  const setTimeoutHandler = vm.newFunction('setTimeout', (funcHandle, timeoutHandle) => {
    const ttl = vm.getNumber(timeoutHandle);
    const ref = funcHandle.dup();
    const timeout = setTimeout(() => {
      if (disposed) return;
      refs.delete(key);
      const result = vm.callFunction(ref, vm.global);
      if (result.error) {
        result.error.dispose();
      } else {
        result.value.dispose();
      }
      ref.dispose();
      vm.runtime.executePendingJobs(-1);
    }, ttl);

    const key = typeof timeout === 'number' ? timeout : Math.round(Math.random() * 10000);
    refs.set(key, ref);
    return vm.newNumber(key);
  });
  vm.setProp(vm.global, 'setTimeout', setTimeoutHandler);
  setTimeoutHandler.dispose();

  const clearTimeoutHandler = vm.newFunction('clearTimeout', timeoutHandle => {
    const key = vm.getNumber(timeoutHandle);
    const ref = refs.get(key);
    if (ref) {
      clearTimeout(key);
      ref.dispose();
      refs.delete(key);
      vm.runtime.executePendingJobs(-1);
    }
  });
  vm.setProp(vm.global, 'clearTimeout', clearTimeoutHandler);
  clearTimeoutHandler.dispose();

  return () => {
    disposed = true;
    for (const [key, ref] of refs) {
      clearTimeout(key);
      ref.dispose();
    }
    refs.clear();
  };
}

export function injectIntervals(vm: QuickJSContext): VoidFunction {
  const refs = new Map<number, Lifetime<any, any, any>>();
  let disposed = false;

  const setIntervalHandler = vm.newFunction('setInterval', (funcHandle, timeoutHandle) => {
    const ttl = vm.getNumber(timeoutHandle);
    const ref = funcHandle.dup();
    const interval = setInterval(() => {
      if (disposed) return;
      const result = vm.callFunction(ref, vm.global);
      if (result.error) {
        result.error.dispose();
      } else {
        result.value.dispose();
      }
      vm.runtime.executePendingJobs(-1);
    }, ttl);

    const key = typeof interval === 'number' ? interval : Math.round(Math.random() * 10000);
    refs.set(key, ref);
    return vm.newNumber(key);
  });
  vm.setProp(vm.global, 'setInterval', setIntervalHandler);
  setIntervalHandler.dispose();

  const clearIntervalHandler = vm.newFunction('clearInterval', timeoutHandle => {
    const key = vm.getNumber(timeoutHandle);
    const ref = refs.get(key);
    if (ref) {
      clearInterval(key);
      ref.dispose();
      refs.delete(key);
      vm.runtime.executePendingJobs(-1);
    }
  });
  vm.setProp(vm.global, 'clearInterval', clearIntervalHandler);
  clearIntervalHandler.dispose();

  return () => {
    disposed = true;
    for (const [key, ref] of refs) {
      clearInterval(key);
      ref.dispose();
    }
    refs.clear();
  };
}
