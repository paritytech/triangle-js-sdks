import type { JsonRpcConnection, JsonRpcProvider } from '@polkadot-api/json-rpc-provider';
import { createNanoEvents } from 'nanoevents';

import { id } from './helpers.js';
import { createRefCounter } from './refCounter.js';
import type { BranchedProvider } from './types.js';

type Params = {
  enhanceBranch?(branch: JsonRpcProvider): JsonRpcProvider;
};

export const createBranchedProvider = (provider: JsonRpcProvider, params?: Params): BranchedProvider => {
  const enhancer = params?.enhanceBranch ?? id;

  const messages = createNanoEvents<{ incoming: (v: string) => void }>();
  const refs = createRefCounter<'connection'>();
  let connection: JsonRpcConnection | null = null;

  return {
    branch(onDisconnect): JsonRpcProvider {
      return enhancer(onMessage => {
        if (!connection) {
          connection = provider(message => messages.emit('incoming', message));
        }

        const unsub = messages.on('incoming', onMessage);

        refs.increment('connection');

        return {
          send(message) {
            connection?.send(message);
          },
          disconnect() {
            if (refs.decrement('connection') === 0) {
              connection?.disconnect();
              connection = null;
            }

            onDisconnect?.();
            unsub();
          },
        };
      });
    },
  };
};
