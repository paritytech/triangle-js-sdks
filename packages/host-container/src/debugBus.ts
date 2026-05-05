import { createNanoEvents } from 'nanoevents';

import type { HostApiDebugMessageEvent } from './types.js';

/**
 * EXPERIMENTAL: process-global bus that aggregates debug events from
 * every container created in this process. Subscribing here gives a
 * single subscriber visibility into all host ↔ product traffic across
 * every active container, annotated with the `productId` passed to
 * `createContainer` (if any).
 */
const bus = createNanoEvents<{
  message: (event: HostApiDebugMessageEvent) => void;
}>();

/** @internal Used by `createContainer` to forward its transport's debug events. */
export function emitHostApiDebugMessage(event: HostApiDebugMessageEvent): void {
  bus.emit('message', event);
}

/**
 * EXPERIMENTAL. Subscribe to every host ↔ product message across all
 * containers in the current process. Returns an unsubscribe function.
 */
export function onHostApiDebugMessage(callback: (event: HostApiDebugMessageEvent) => void): VoidFunction {
  return bus.on('message', callback);
}
