import type { QuickJSContext, QuickJSHandle } from 'quickjs-emscripten';

// Timer registries store the actual Node Timeout / browser integer alongside a
// monotonic id; the id is what the sandbox sees. This lets clearTimeout/Interval
// reliably cancel the underlying timer (passing a random integer to Node's
// clearTimeout is a no-op — the timer keeps running and would invoke the
// disposed callback handle, causing use-after-free).
type TimerHandle = ReturnType<typeof setTimeout>;
type TimerEntry = { ref: QuickJSHandle; timer: TimerHandle };

export function injectTimeouts(vm: QuickJSContext): VoidFunction {
  const refs = new Map<number, TimerEntry>();
  let nextId = 1;
  let disposed = false;

  const setTimeoutHandler = vm.newFunction('setTimeout', (funcHandle, timeoutHandle) => {
    const ttl = vm.getNumber(timeoutHandle);
    const ref = funcHandle.dup();
    const id = nextId++;
    const timer = setTimeout(() => {
      refs.delete(id);
      if (disposed) {
        ref.dispose();
        return;
      }
      const result = vm.callFunction(ref, vm.global);
      ref.dispose();
      if (result.error) result.error.dispose();
      else result.value.dispose();
      vm.runtime.executePendingJobs(-1);
    }, ttl);
    refs.set(id, { ref, timer });
    return vm.newNumber(id);
  });
  vm.setProp(vm.global, 'setTimeout', setTimeoutHandler);
  setTimeoutHandler.dispose();

  const clearTimeoutHandler = vm.newFunction('clearTimeout', idHandle => {
    const id = vm.getNumber(idHandle);
    const entry = refs.get(id);
    if (entry) {
      clearTimeout(entry.timer);
      entry.ref.dispose();
      refs.delete(id);
    }
  });
  vm.setProp(vm.global, 'clearTimeout', clearTimeoutHandler);
  clearTimeoutHandler.dispose();

  return () => {
    disposed = true;
    for (const entry of refs.values()) {
      clearTimeout(entry.timer);
      entry.ref.dispose();
    }
    refs.clear();
  };
}

export function injectIntervals(vm: QuickJSContext): VoidFunction {
  const refs = new Map<number, TimerEntry>();
  let nextId = 1;
  let disposed = false;

  const setIntervalHandler = vm.newFunction('setInterval', (funcHandle, timeoutHandle) => {
    const ttl = vm.getNumber(timeoutHandle);
    const ref = funcHandle.dup();
    const id = nextId++;
    const timer = setInterval(() => {
      if (disposed) return;
      const result = vm.callFunction(ref, vm.global);
      if (result.error) result.error.dispose();
      else result.value.dispose();
      vm.runtime.executePendingJobs(-1);
    }, ttl);
    refs.set(id, { ref, timer });
    return vm.newNumber(id);
  });
  vm.setProp(vm.global, 'setInterval', setIntervalHandler);
  setIntervalHandler.dispose();

  const clearIntervalHandler = vm.newFunction('clearInterval', idHandle => {
    const id = vm.getNumber(idHandle);
    const entry = refs.get(id);
    if (entry) {
      clearInterval(entry.timer);
      entry.ref.dispose();
      refs.delete(id);
    }
  });
  vm.setProp(vm.global, 'clearInterval', clearIntervalHandler);
  clearIntervalHandler.dispose();

  return () => {
    disposed = true;
    for (const entry of refs.values()) {
      clearInterval(entry.timer);
      entry.ref.dispose();
    }
    refs.clear();
  };
}

export function injectQueueMicrotask(vm: QuickJSContext): VoidFunction {
  const pendingRefs = new Set<QuickJSHandle>();
  let disposed = false;

  const queueMicrotaskHandler = vm.newFunction('queueMicrotask', funcHandle => {
    const ref = funcHandle.dup();
    pendingRefs.add(ref);
    queueMicrotask(() => {
      pendingRefs.delete(ref);
      if (disposed) {
        ref.dispose();
        return;
      }
      const result = vm.callFunction(ref, vm.global);
      ref.dispose();
      if (result.error) result.error.dispose();
      else result.value.dispose();
      vm.runtime.executePendingJobs(-1);
    });
    return vm.undefined;
  });
  vm.setProp(vm.global, 'queueMicrotask', queueMicrotaskHandler);
  queueMicrotaskHandler.dispose();

  return () => {
    disposed = true;
    for (const ref of pendingRefs) ref.dispose();
    pendingRefs.clear();
  };
}
