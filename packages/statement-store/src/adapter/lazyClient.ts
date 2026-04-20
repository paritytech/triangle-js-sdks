import type { RequestFn, SubscribeFn } from '@novasamatech/sdk-statement';
import type { SubstrateClient } from '@polkadot-api/substrate-client';
import { createClient as createSubstrateClient } from '@polkadot-api/substrate-client';
import type { JsonRpcProvider, PolkadotClient } from 'polkadot-api';
import { createClient as createPolkadotClient } from 'polkadot-api';

export type LazyClient = ReturnType<typeof createLazyClient>;

// eslint-disable-next-line @typescript-eslint/no-empty-function
const noop = () => {};

export const createLazyClient = (provider: JsonRpcProvider) => {
  let polkadotClient: PolkadotClient | null = null;
  let substrateClient: SubstrateClient | null = null;

  function getSubstrateClient() {
    if (!substrateClient) {
      substrateClient = createSubstrateClient(provider);
    }
    return substrateClient;
  }

  return {
    getClient() {
      if (!polkadotClient) {
        polkadotClient = createPolkadotClient(provider);
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
        let subscriptionId: string | null = null;
        let unsubscribeLocal: (() => void) | null = null;
        const cancelRequest = c._request<string, T>(method, params, {
          onSuccess: (subId, followSubscription) => {
            subscriptionId = subId;
            unsubscribeLocal = followSubscription(subId, { next: onMessage, error: onError });
          },
          onError,
        });
        // Derive the unsubscribe RPC method from the subscribe method name
        // e.g. statement_subscribeStatement -> statement_unsubscribeStatement
        const unsubscribeMethod = method.replace('subscribe', 'unsubscribe');
        return () => {
          if (unsubscribeLocal) {
            unsubscribeLocal();
            // Send the server-side unsubscribe RPC call
            c._request(unsubscribeMethod, [subscriptionId], {
              onSuccess: noop,
              onError: noop,
            });
          } else {
            cancelRequest();
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
