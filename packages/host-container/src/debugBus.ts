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

type DebugSource = () => VoidFunction;
const sources = new Set<DebugSource>();
const activeSources = new Map<DebugSource, VoidFunction>();
let subscriberCount = 0;

function activateSource(source: DebugSource): void {
  if (activeSources.has(source)) return;
  activeSources.set(source, source());
}

function deactivateSource(source: DebugSource): void {
  const unsubscribe = activeSources.get(source);
  if (!unsubscribe) return;
  activeSources.delete(source);
  unsubscribe();
}

/** @internal Used by `createContainer` to forward its transport's debug events. */
export function emitHostApiDebugMessage(event: HostApiDebugMessageEvent): void {
  bus.emit('message', event);
}

/**
 * @internal Register a transport-level forwarder for the global bus.
 * The source is activated only while the bus has at least one subscriber
 * and deactivated when the last one unsubscribes — this preserves the
 * transport's lazy decode path (no `Message.dec` per frame) when nobody
 * is listening downstream.
 */
export function registerHostApiDebugSource(source: DebugSource): VoidFunction {
  sources.add(source);
  if (subscriberCount > 0) activateSource(source);
  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    sources.delete(source);
    deactivateSource(source);
  };
}

/**
 * EXPERIMENTAL. Subscribe to every host ↔ product message across all
 * containers in the current process. Returns an unsubscribe function.
 */
export function onHostApiDebugMessage(callback: (event: HostApiDebugMessageEvent) => void): VoidFunction {
  const wasZero = subscriberCount === 0;
  subscriberCount++;
  if (wasZero) {
    for (const source of sources) activateSource(source);
  }
  const unsubscribe = bus.on('message', callback);
  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    unsubscribe();
    subscriberCount--;
    if (subscriberCount === 0) {
      for (const source of [...activeSources.keys()]) deactivateSource(source);
    }
  };
}
