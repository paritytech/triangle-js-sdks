import { createNanoEvents } from 'nanoevents';

import type { HostApiDebugMessageEvent } from './types.js';

/**
 * EXPERIMENTAL: module-level bus that aggregates debug events from every
 * container created in this process. Subscribing once here gives you all
 * host <-> product messages for all active containers, annotated with the
 * `productId` that was passed to `createContainer` (if any).
 */
const bus = createNanoEvents<{ message: (event: HostApiDebugMessageEvent) => void }>();

/** @internal used by `createContainer` to forward its debug events. */
export function emitHostApiDebugMessage(event: HostApiDebugMessageEvent): void {
  bus.emit('message', event);
}

/**
 * EXPERIMENTAL: subscribe to every host <-> product message across all
 * containers in the current process. The callback runs for each message in
 * decoded (non-SCALE-encoded) form. Returns an unsubscribe function.
 */
export function onHostApiDebugMessage(callback: (event: HostApiDebugMessageEvent) => void): VoidFunction {
  return bus.on('message', callback);
}
