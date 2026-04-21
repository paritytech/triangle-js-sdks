import { createNanoEvents } from 'nanoevents';
import { nanoid } from 'nanoid';

import type { HostPappDebugEvent } from './debugTypes.js';

/**
 * EXPERIMENTAL: module-level bus that aggregates debug events from
 * every host-papp adapter created in the process. Matches the pattern
 * used by `onHostApiDebugMessage` in `@novasamatech/host-container` so
 * a single subscriber can observe pairing / attestation / session
 * activity alongside TrUAPI traffic.
 *
 * Subscription is *lazy* in spirit: the helpers below are deliberately
 * cheap so call sites can construct payloads conditionally with
 * `hasHostPappDebugListeners()` when the payload would otherwise be
 * expensive to produce.
 */
const bus = createNanoEvents<{ message: (event: HostPappDebugEvent) => void }>();
let listenerCount = 0;

/** @internal for host-papp emitters. */
export function emitHostPappDebugMessage(event: HostPappDebugEvent): void {
  if (listenerCount === 0) {
    return;
  }
  bus.emit('message', event);
}

/**
 * @internal
 * Lets call sites skip non-trivial payload construction when nobody is
 * listening. Equivalent in spirit to the lazy subscribe pattern in
 * host-api's transport-level hook.
 */
export function hasHostPappDebugListeners(): boolean {
  return listenerCount > 0;
}

/**
 * EXPERIMENTAL: subscribe to every host-papp debug event across all
 * adapters in the current process. Returns an unsubscribe function.
 */
export function onHostPappDebugMessage(callback: (event: HostPappDebugEvent) => void): VoidFunction {
  listenerCount++;
  const unsubscribe = bus.on('message', callback);
  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    listenerCount = Math.max(0, listenerCount - 1);
    unsubscribe();
  };
}

/** @internal — convenience for creating flow identifiers. */
export function createFlowId(): string {
  return nanoid();
}
