import type { JsonRpcProvider } from '@polkadot-api/json-rpc-provider';
import { getSyncProvider } from '@polkadot-api/json-rpc-provider-proxy';
import { createClient } from 'polkadot-api';

import { createBranchedProvider } from './branchedProvider.js';
import { createConnectionManager } from './connectionManager.js';
import { createRefCounter } from './refCounter.js';
import type { ChainConfig, ConnectionStatus, PooledClient } from './types.js';

export type ConnectionPoolConfig<C extends ChainConfig> = {
  createProvider: (chain: C, reportStatus: (status: ConnectionStatus) => void) => JsonRpcProvider;
  getClientOptions?: (chain: C) => Parameters<typeof createClient>[1];
};

export type ConnectionPool<C extends ChainConfig> = {
  lockClient(chain: C): Promise<{ pooled: PooledClient; unlock: VoidFunction }>;
  requestClient<Return>(chain: C, callback: (pooled: PooledClient) => Return): Promise<Return>;
  getProvider(chain: C): JsonRpcProvider;
  getConnectionStatus(chainId: string): ConnectionStatus;
  onStatusChange(chainId: string, callback: (status: ConnectionStatus) => void): VoidFunction;
};

export const createConnectionPool = <C extends ChainConfig>(config: ConnectionPoolConfig<C>): ConnectionPool<C> => {
  const connections = createConnectionManager();
  const refCounter = createRefCounter<string>();
  const existingClients = new Map<string, PooledClient>();

  const getOrCreateClient = (chain: C): PooledClient => {
    const existing = existingClients.get(chain.chainId);
    if (existing) return existing;

    const provider = config.createProvider(chain, status => connections.update(chain.chainId, status));
    const branchedProvider = createBranchedProvider(provider);
    const client = createClient(branchedProvider.branch(), config.getClientOptions?.(chain));

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
  };

  const pool: ConnectionPool<C> = {
    async lockClient(chain) {
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
    },

    async requestClient(chain, callback) {
      const { pooled, unlock } = await pool.lockClient(chain);

      try {
        return await callback(pooled);
      } finally {
        unlock();
      }
    },

    getProvider(chain) {
      return getSyncProvider(async () => {
        const { pooled, unlock } = await pool.lockClient(chain);
        return pooled.provider.branch(unlock);
      });
    },

    getConnectionStatus(chainId) {
      return connections.getConnectionStatus(chainId);
    },

    onStatusChange(chainId, callback) {
      return connections.onStatusChange(chainId, callback);
    },
  };

  return pool;
};
