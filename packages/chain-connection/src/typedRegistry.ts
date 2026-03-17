import type { JsonRpcProvider } from '@polkadot-api/json-rpc-provider';
import type { ChainDefinition } from 'polkadot-api';
import { getTypedCodecs } from 'polkadot-api';

import type { ConnectionPool } from './connectionPool.js';
import type { ChainConfig, ConnectionStatus, PooledClient, TypedClient } from './types.js';

export type TypedRegistryConfig<C extends ChainConfig, D extends ChainDefinition> = {
  pool: ConnectionPool<C>;
  getDescriptor: (chain: C) => D;
};

export type TypedRegistry<C extends ChainConfig, D extends ChainDefinition> = {
  lockApi(chain: C): Promise<{ api: TypedClient<D>; unlock: VoidFunction }>;
  requestApi<Return>(chain: C, callback: (api: TypedClient<D>) => Return): Promise<Return>;
  getProvider(chain: C): JsonRpcProvider;
  getConnectionStatus(chainId: string): ConnectionStatus;
  onStatusChange(chainId: string, callback: (status: ConnectionStatus) => void): VoidFunction;
};

export const createTypedRegistry = <C extends ChainConfig, D extends ChainDefinition>(
  config: TypedRegistryConfig<C, D>,
): TypedRegistry<C, D> => {
  const existingApis = new Map<string, TypedClient<D>>();
  const pendingApis = new Map<string, Promise<TypedClient<D>>>();

  const resolveApi = (chain: C, pooled: PooledClient): Promise<TypedClient<D>> => {
    const existing = existingApis.get(chain.chainId);
    if (existing && existing.client === pooled.client) {
      return Promise.resolve(existing);
    }

    const pending = pendingApis.get(chain.chainId);
    if (pending) return pending;

    const promise = (async () => {
      const descriptor = config.getDescriptor(chain);
      const api = pooled.client.getTypedApi(descriptor);
      const compatibilityToken = await api.compatibilityToken;
      const codecs = await getTypedCodecs(descriptor);

      const typedClient: TypedClient<D> = {
        client: pooled.client,
        api,
        codecs,
        compatibilityToken,
        provider: pooled.provider,
      };

      existingApis.set(chain.chainId, typedClient);
      return typedClient;
    })();

    pendingApis.set(chain.chainId, promise);
    promise.finally(() => pendingApis.delete(chain.chainId));
    return promise;
  };

  const registry: TypedRegistry<C, D> = {
    async lockApi(chain) {
      const { pooled, unlock } = await config.pool.lockClient(chain);

      try {
        const api = await resolveApi(chain, pooled);
        return { api, unlock };
      } catch (error) {
        unlock();
        throw error;
      }
    },

    async requestApi(chain, callback) {
      const { api, unlock } = await registry.lockApi(chain);

      try {
        return await callback(api);
      } finally {
        unlock();
      }
    },

    getProvider(chain) {
      return config.pool.getProvider(chain);
    },

    getConnectionStatus(chainId) {
      return config.pool.getConnectionStatus(chainId);
    },

    onStatusChange(chainId, callback) {
      return config.pool.onStatusChange(chainId, callback);
    },
  };

  return registry;
};
