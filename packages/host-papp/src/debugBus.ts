import { createNanoEvents } from 'nanoevents';
import { nanoid } from 'nanoid';

import type { HostPappDebugEvent } from './debugTypes.js';

/**
 * EXPERIMENTAL. Module-level bus that aggregates debug events from
 * every host-papp adapter created in this process. Mirrors the
 * pattern used by `onHostApiDebugMessage` in
 * `@novasamatech/host-container` so a single subscriber can observe
 * pairing / attestation / session activity alongside TrUAPI traffic.
 *
 * Subscription is *lazy in spirit*: emit sites should call
 * `hasHostPappDebugListeners()` before constructing payloads that
 * are non-trivial to compute.
 */
const bus = createNanoEvents<{
  message: (event: HostPappDebugEvent) => void;
}>();

let listenerCount = 0;

/** @internal For host-papp emitters. */
export function emitHostPappDebugMessage(event: HostPappDebugEvent): void {
  try {
    if (listenerCount === 0) return;
    bus.emit('message', event);
  } catch {
    // do nothing
  }
}

/**
 * @internal Lets call sites skip non-trivial payload construction
 * when nobody is listening. Equivalent in spirit to the lazy
 * subscribe pattern in host-api's transport-level hook.
 */
export function hasHostPappDebugListeners(): boolean {
  return listenerCount > 0;
}

/**
 * EXPERIMENTAL. Subscribe to every host-papp debug event across all
 * adapters in the current process. Returns an unsubscribe function.
 *
 * Each listener is isolated: a throw inside one callback is logged
 * to `console.error` and does not starve sibling subscribers — the
 * same pattern host-api uses in its transport-level debug hook.
 */
export function onHostPappDebugMessage(callback: (event: HostPappDebugEvent) => void): VoidFunction {
  listenerCount++;
  const safeCallback = (event: HostPappDebugEvent) => {
    try {
      callback(event);
    } catch (e) {
      console.error('host-papp debug listener threw', e);
    }
  };
  const unsubscribe = bus.on('message', safeCallback);
  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    listenerCount = Math.max(0, listenerCount - 1);
    unsubscribe();
  };
}

/** @internal Convenience for creating flow identifiers. */
export function createFlowId(): string {
  return nanoid();
}
