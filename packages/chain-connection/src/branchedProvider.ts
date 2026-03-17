import type { JsonRpcConnection, JsonRpcProvider } from '@polkadot-api/json-rpc-provider';
import { createNanoEvents } from 'nanoevents';

import { createRefCounter } from './refCounter.js';
import type { BranchedProvider } from './types.js';

export const createBranchedProvider = (provider: JsonRpcProvider): BranchedProvider => {
  const messages = createNanoEvents<{ incoming: (v: string) => void }>();
  const refs = createRefCounter<'connection'>();
  let connection: JsonRpcConnection | null = null;

  return {
    branch(onDisconnect): JsonRpcProvider {
      return onMessage => {
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
      };
    },
  };
};
