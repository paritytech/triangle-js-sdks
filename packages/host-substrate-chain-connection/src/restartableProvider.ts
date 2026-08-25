import type { JsonRpcConnection } from '@polkadot-api/json-rpc-provider';
import { getSyncProvider } from '@polkadot-api/json-rpc-provider-proxy';
import type { JsonRpcProvider } from 'polkadot-api';

import { noop } from './helpers.js';
import { withSubscriptionReplay } from './subscriptionReplayProvider.js';
import { isPausable } from './wsProvider.js';

export type RestartableJsonRpcProvider = JsonRpcProvider & {
  /**
   * Throw the live transport away and build a new one from the factory, without
   * tearing down the consumers hanging off this provider. Callers use it to move
   * a chain onto a different transport — a light client to an RPC node, say —
   * while clients, subscriptions and refcounts stay where they are.
   */
  restart(): void;
  /** Forwarded to the current transport when it supports it; otherwise a no-op. */
  pause(): void;
  resume(): void;
};

type ActiveTransport = {
  provider: JsonRpcProvider;
  connection: JsonRpcConnection;
  // The proxy's own halt trigger. Calling it is what makes `getSyncProvider` ask
  // the factory for the next transport.
  halt(error?: unknown): void;
};

/**
 * A provider whose underlying transport can be replaced at any time.
 *
 * The swap is dressed up as a connection drop, which is the one event every
 * layer above already knows how to survive: `getSyncProvider`'s proxy reports
 * the active `chainHead` follows as stopped and re-sends the requests that were
 * in flight, so polkadot-api re-follows on the new transport by itself, and the
 * subscription-replay wrapper re-establishes the legacy subscriptions that
 * `chainHead` bookkeeping does not cover. Consumers see the same interruption a
 * dropped socket would have caused, and nothing above has to be rebuilt.
 */
export const createRestartableProvider = (createTransport: () => JsonRpcProvider): RestartableJsonRpcProvider => {
  let active: ActiveTransport | null = null;
  let notifyReconnect: VoidFunction = noop;
  // Survives a restart: a transport built while the host has the pool paused
  // must come up paused too, or backgrounding the app would stop holding.
  let paused = false;

  const onReconnect = (callback: VoidFunction): VoidFunction => {
    notifyReconnect = callback;

    return () => {
      notifyReconnect = noop;
    };
  };

  const core = getSyncProvider(onResult => {
    onResult((onMessage, halt) => {
      const provider = createTransport();
      // The transport's own halt channel is deliberately not wired up: a
      // transport either recovers on its own (the ws provider proxies its
      // reconnects internally) or reports `disconnected` and stays down. `halt`
      // is kept for `restart`, which is the only reason this layer replaces one.
      const connection = provider(onMessage);
      const transport: ActiveTransport = { provider, connection, halt };
      active = transport;

      if (paused && isPausable(provider)) provider.pause();

      return {
        send: message => connection.send(message),
        disconnect: () => {
          if (active === transport) active = null;
          connection.disconnect();
        },
      };
    });

    // `onResult` runs the proxy's connect synchronously, so by here the proxy is
    // connected and the replayed subscribes go out on the new transport rather
    // than into a buffer that a failed connect would discard.
    notifyReconnect();

    // Nothing to cancel: `onResult` above already resolved this attempt.
    return noop;
  });

  const provider = withSubscriptionReplay(core, onReconnect);

  return Object.assign(provider, {
    restart() {
      const transport = active;
      // Nothing to replace while the proxy is between transports — whatever it
      // asks the factory for next is already built from the current settings.
      if (!transport) return;

      active = null;
      // Close before halting: the halt schedules the next `createTransport`, and
      // a transport left open would keep its socket (or light client) running
      // alongside its replacement.
      transport.connection.disconnect();
      transport.halt();
    },
    pause() {
      paused = true;
      const transport = active?.provider;
      if (transport && isPausable(transport)) transport.pause();
    },
    resume() {
      paused = false;
      const transport = active?.provider;
      if (transport && isPausable(transport)) transport.resume();
    },
  });
};
