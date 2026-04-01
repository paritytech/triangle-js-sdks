import type { RequestFn, SubscribeFn } from '@novasamatech/sdk-statement';
import type { JsonRpcProvider } from '@polkadot-api/json-rpc-provider';
import type { SubstrateClient } from '@polkadot-api/substrate-client';
import { createClient as createSubstrateClient } from '@polkadot-api/substrate-client';
import type { PolkadotClient } from 'polkadot-api';
import { createClient as createPolkadotClient } from 'polkadot-api';

/**
 * Wrap a JsonRpcProvider so it can be called multiple times while sharing
 * a single underlying connection.  Incoming messages are broadcast to every
 * active consumer; outgoing messages from any consumer go through the same
 * send channel.
 */
function createSharedProvider(provider: JsonRpcProvider): JsonRpcProvider {
  let connection: ReturnType<JsonRpcProvider> | null = null;
  const listeners = new Set<(msg: string) => void>();

  return onMessage => {
    listeners.add(onMessage);

    if (!connection) {
      connection = provider(msg => {
        for (const l of listeners) l(msg);
      });
    }

    return {
      send: msg => connection!.send(msg),
      disconnect: () => {
        listeners.delete(onMessage);
        if (listeners.size === 0 && connection) {
          connection.disconnect();
          connection = null;
        }
      },
    };
  };
}

export type LazyClient = ReturnType<typeof createLazyClient>;

export const createLazyClient = (provider: JsonRpcProvider) => {
  // Wrap the provider so that both SubstrateClient (used for low-level
  // statement-store RPC) and PolkadotClient (used for typed chain queries)
  // share a single connection instead of racing on nextJsonRpcResponse().
  const shared = createSharedProvider(provider);

  let polkadotClient: PolkadotClient | null = null;
  let substrateClient: SubstrateClient | null = null;

  function getSubstrateClient() {
    if (!substrateClient) {
      substrateClient = createSubstrateClient(shared);
    }
    return substrateClient;
  }

  return {
    getClient() {
      if (!polkadotClient) {
        polkadotClient = createPolkadotClient(shared);
      }
      return polkadotClient;
    },
    getRequestFn(): RequestFn {
      const c = getSubstrateClient();
      return <Reply>(method: string, params: unknown[]) =>
        new Promise<Reply>((resolve, reject) => {
          c._request<Reply, unknown>(method, params, {
            onSuccess: result => resolve(result),
            onError: e => reject(e),
          });
        });
    },
    getSubscribeFn(): SubscribeFn {
      const c = getSubstrateClient();
      return <T>(
        method: string,
        params: unknown[],
        onMessage: (message: T) => void,
        onError: (error: Error) => void,
      ) => {
        let subscriptionId: string | undefined;
        let unsubscribeSubscription: VoidFunction | undefined;
        const unsubscribeRequest = c._request<string, T>(method, params, {
          onSuccess: (id, followSubscription) => {
            subscriptionId = id;
            unsubscribeSubscription = followSubscription(id, {
              next: onMessage,
              error: onError,
            });
          },
          onError,
        });

        // Derive the unsubscribe RPC method name from the subscribe method.
        // Convention: "statement_subscribeStatement" → "statement_unsubscribeStatement"
        const unsubscribeMethod = method.replace('subscribe', 'unsubscribe');

        return () => {
          unsubscribeSubscription?.();
          unsubscribeRequest();
          if (subscriptionId !== undefined) {
            c._request(unsubscribeMethod, [subscriptionId]);
          }
        };
      };
    },
    disconnect() {
      if (polkadotClient) {
        polkadotClient.destroy();
      }
      if (substrateClient) {
        substrateClient.destroy();
      }
    },
  };
};
