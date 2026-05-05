import type { RequestFn, SubscribeFn } from '@novasamatech/sdk-statement';
import type { JsonRpcProvider, PolkadotClient } from 'polkadot-api';
import { createClient as createPolkadotClient } from 'polkadot-api';

export type LazyClient = ReturnType<typeof createLazyClient>;

export const createLazyClient = (provider: JsonRpcProvider) => {
  let polkadotClient: PolkadotClient | null = null;

  function getPolkadotClient() {
    if (!polkadotClient) {
      polkadotClient = createPolkadotClient(provider);
    }
    return polkadotClient;
  }

  return {
    getClient() {
      return getPolkadotClient();
    },
    getRequestFn(): RequestFn {
      const c = getPolkadotClient();
      return <Reply>(method: string, params: unknown[]) => c._request<Reply>(method, params);
    },
    getSubscribeFn(): SubscribeFn {
      const c = getPolkadotClient();
      return <T>(
        method: string,
        params: unknown[],
        onMessage: (message: T) => void,
        onError: (error: Error) => void,
      ) => {
        // Derive the unsubscribe RPC method from the subscribe method name
        // e.g. statement_subscribeStatement -> statement_unsubscribeStatement
        const unsubscribeMethod = method.replace('subscribe', 'unsubscribe');
        const subscription = c._subscribe<T>(method, unsubscribeMethod, params).subscribe({
          next: onMessage,
          error: onError,
        });
        return () => subscription.unsubscribe();
      };
    },
    disconnect() {
      if (polkadotClient) {
        polkadotClient.destroy();
        polkadotClient = null;
      }
    },
  };
};
