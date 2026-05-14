/**
 * Facade transport built on `@parity/truapi`.
 *
 * Replaces the bespoke request correlation, subscription router, and wire
 * frame envelope that `transport.ts` currently owns with the equivalent
 * primitives from `@parity/truapi`. The public surface intentionally mirrors
 * `Transport` from `./types.ts` so consumers of `createHostApi` and the
 * factories in `host-container` can switch over without churn.
 *
 * What this file does NOT do, by design:
 * - Subscription multiplexing or dedup. `@parity/truapi` exposes 1:1 wire
 *   subscriptions, products that need fan-out layer their own.
 * - Inbound handler registration (`handleRequest`, `handleSubscription`).
 *   Hosts should use `@parity/truapi-host`'s typed dispatcher instead, and
 *   `host-container`'s `createContainer` is being migrated onto it in
 *   `truapi-container.ts`.
 *
 * Status: directional. Active handshake retry, connection-status events, and
 * the legacy `postMessage`/`listenMessages` low-level helpers still need to
 * be re-implemented on top of this. See `MIGRATION.md` for the punch list.
 */

import type { Provider as TruapiProvider, TrUApiTransport } from '@parity/truapi';
import { createTransport as createTruapiTransport } from '@parity/truapi';
import { createNanoEvents } from 'nanoevents';

import type { Provider } from './provider.js';
import type { ConnectionStatus, Logger } from './types.js';

/**
 * Adapt a legacy `Provider` (postMessage/listenMessages over wire-frame
 * codec objects) to the raw byte-level `Provider` shape `@parity/truapi`
 * expects.
 *
 * The legacy provider already speaks SCALE-encoded wire frames, so this is
 * a pass-through, message-codec wrapping and unwrapping is now owned by
 * `@parity/truapi`'s `encodeWireMessage`/`decodeWireMessage`.
 */
function adaptProvider(provider: Provider): TruapiProvider {
  return {
    postMessage(bytes) {
      // The legacy `Provider` postMessage accepts already-encoded bytes; the
      // wrapping `MessageProvider.postMessage(message)` indirection that
      // `transport.ts` adds to encode the wire-frame envelope is now
      // performed by `@parity/truapi.createTransport`.
      provider.postMessage(bytes);
    },
    subscribe(callback) {
      const unsub = provider.subscribe(callback);
      return () => unsub();
    },
    dispose() {
      provider.dispose();
    },
  };
}

export interface TruapiTransportOptions {
  logger?: Logger;
}

export interface TruapiTransport {
  /**
   * Underlying `@parity/truapi` transport. Generated client modules accept
   * this directly; legacy `host-api` consumers wrap it via the facade
   * methods below.
   **/
  readonly inner: TrUApiTransport;

  /**
   * Subscribe to connection-status changes. Mirrors the legacy
   * `onConnectionStatusChange` surface.
   **/
  onConnectionStatusChange(callback: (status: ConnectionStatus) => void): VoidFunction;

  /**
   * Tear down the transport and detach provider listeners.
   **/
  destroy(): void;
}

/**
 * Build a `@parity/truapi` transport bound to the supplied legacy
 * `Provider`. Generated client modules (from `@parity/truapi`) accept the
 * returned `inner` transport directly.
 */
export function createTruapiTransportFacade(
  provider: Provider,
  _options: TruapiTransportOptions = {},
): TruapiTransport {
  const status = createNanoEvents<{
    change: (status: ConnectionStatus) => void;
  }>();
  let currentStatus: ConnectionStatus = 'connecting';

  const inner = createTruapiTransport(adaptProvider(provider));

  return {
    inner,
    onConnectionStatusChange(callback) {
      callback(currentStatus);
      return status.on('change', callback);
    },
    destroy() {
      inner.dispose();
      currentStatus = 'disconnected';
      status.emit('change', currentStatus);
    },
  };
}
