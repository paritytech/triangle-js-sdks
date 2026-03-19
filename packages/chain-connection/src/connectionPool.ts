import type { JsonRpcProvider } from '@polkadot-api/json-rpc-provider';
import { getSyncProvider } from '@polkadot-api/json-rpc-provider-proxy';
import type { PolkadotClient } from 'polkadot-api';
import { createClient } from 'polkadot-api';

import { createBranchedProvider } from './branchedProvider.js';
import { createConnectionManager } from './connectionManager.js';
import { createRefCounter } from './refCounter.js';
import type { ChainConfig, ConnectionStatus, PooledClient } from './types.js';

export type ChainConnectionConfig<C extends ChainConfig, T = PolkadotClient> = {
  createProvider: (chain: C, onStatusChanged: (status: ConnectionStatus) => void) => JsonRpcProvider;
  clientOptions?: (chain: C) => Parameters<typeof createClient>[1];
  resolve?: (chain: C, client: PolkadotClient) => Promise<T>;
};

export type ChainConnection<C extends ChainConfig, T = PolkadotClient> = {
  lockApi(chain: C): Promise<{ api: T; unlock: VoidFunction }>;
  requestApi<Return>(chain: C, callback: (api: T) => Return): Promise<Awaited<Return>>;
  getProvider(chain: C): JsonRpcProvider;
  status(chainId: string): ConnectionStatus;
  onStatusChanged(chainId: string, callback: (status: ConnectionStatus) => void): VoidFunction;
};

export const createChainConnection = <C extends ChainConfig, T = PolkadotClient>(
  config: ChainConnectionConfig<C, T>,
): ChainConnection<C, T> => {
  const connections = createConnectionManager();
  const refCounter = createRefCounter<string>();
  const existingClients = new Map<string, PooledClient>();

  // Resolve cache (when config.resolve is provided)
  const resolvedApis = new Map<string, { resolved: T; polkadotClient: PolkadotClient }>();
  const pendingResolutions = new Map<string, Promise<T>>();

  const getOrCreateClient = (chain: C): PooledClient => {
    const existing = existingClients.get(chain.chainId);
    if (existing) return existing;

    const provider = config.createProvider(chain, status => connections.update(chain.chainId, status));
    const branchedProvider = createBranchedProvider(provider);
    const client = createClient(branchedProvider.branch(), config.clientOptions?.(chain));

    const pooled: PooledClient = { client, provider: branchedProvider };
    existingClients.set(chain.chainId, pooled);
    return pooled;
  };

  const destroyClient = (chainId: string) => {
    const pooled = existingClients.get(chainId);
    if (pooled) {
      existingClients.delete(chainId);
      connections.update(chainId, 'disconnected');
      pooled.client.destroy();
    }
    resolvedApis.delete(chainId);
    pendingResolutions.delete(chainId);
  };

  const rawAcquire = async (chain: C) => {
    try {
      refCounter.increment(chain.chainId);
      const pooled = getOrCreateClient(chain);
      await pooled.client.getBestBlocks();

      return {
        pooled,
        unlock() {
          refCounter.decrement(chain.chainId);
        },
      };
    } catch (error) {
      if (refCounter.decrement(chain.chainId) === 0) {
        destroyClient(chain.chainId);
      }
      throw error;
    }
  };

  const resolveApi = async (chain: C, polkadotClient: PolkadotClient): Promise<T> => {
    if (!config.resolve) return polkadotClient as unknown as T;

    const existing = resolvedApis.get(chain.chainId);
    if (existing && existing.polkadotClient === polkadotClient) return existing.resolved;

    const pending = pendingResolutions.get(chain.chainId);
    if (pending) return pending;

    const promise = (async () => {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- guarded by early return above
      const resolved = await config.resolve!(chain, polkadotClient);
      resolvedApis.set(chain.chainId, { resolved, polkadotClient });
      return resolved;
    })();

    pendingResolutions.set(chain.chainId, promise);
    promise.finally(() => pendingResolutions.delete(chain.chainId));
    return promise;
  };

  const connection: ChainConnection<C, T> = {
    async lockApi(chain) {
      const { pooled, unlock } = await rawAcquire(chain);

      try {
        const api = await resolveApi(chain, pooled.client);
        return { api, unlock };
      } catch (error) {
        unlock();
        resolvedApis.delete(chain.chainId);
        pendingResolutions.delete(chain.chainId);
        throw error;
      }
    },

    requestApi: (async (chain, callback) => {
      const { api, unlock } = await connection.lockApi(chain);

      try {
        return await callback(api);
      } finally {
        unlock();
      }
    }) as ChainConnection<C, T>['requestApi'],

    getProvider(chain) {
      return getSyncProvider(async () => {
        const { pooled, unlock } = await rawAcquire(chain);
        return pooled.provider.branch(unlock);
      });
    },

    status(chainId) {
      return connections.getConnectionStatus(chainId);
    },

    onStatusChanged(chainId, callback) {
      return connections.onStatusChange(chainId, callback);
    },
  };

  return connection;
};
