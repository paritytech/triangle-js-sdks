import type { RequestFn, SubscribeFn } from '@novasamatech/sdk-statement';
import type { JsonRpcProvider } from '@polkadot-api/json-rpc-provider';
import type { SubstrateClient } from '@polkadot-api/substrate-client';
import { createClient as createSubstrateClient } from '@polkadot-api/substrate-client';
import type { PolkadotClient } from 'polkadot-api';
import { createClient as createPolkadotClient } from 'polkadot-api';

export type LazyClient = ReturnType<typeof createLazyClient>;

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
        return c._request<string, T>(method, params, {
          onSuccess: (subscriptionId, followSubscription) => {
            followSubscription(subscriptionId, { next: onMessage, error: onError });
          },
          onError,
        });
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
