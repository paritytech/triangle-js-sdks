import { getSyncProvider } from '@polkadot-api/json-rpc-provider-proxy';
import type { JsonRpcProvider, PolkadotClient } from 'polkadot-api';
import { createClient } from 'polkadot-api';

import { createBranchedProvider } from './branchedProvider.js';
import { createConnectionManager } from './connectionManager.js';
import { createRefCounter } from './refCounter.js';
import type { ChainConfig, ConnectionStatus, PooledClient } from './types.js';

export type ChainConnectionConfig<C extends ChainConfig, T = PolkadotClient> = {
  createProvider(chain: C, onStatusChanged: (status: ConnectionStatus) => void): JsonRpcProvider;
  clientOptions?(chain: C): Parameters<typeof createClient>[1];
  resolve?(chain: C, client: PolkadotClient): Promise<T>;
  destroyDelay?: number;
};

export type ChainConnection<C extends ChainConfig, T = PolkadotClient> = {
  lockApi(chain: C): Promise<{ api: T; unlock: VoidFunction }>;
  getProvider(chain: C): JsonRpcProvider;
  status(genesisHash: string): ConnectionStatus;
  onStatusChanged(genesisHash: string, callback: (status: ConnectionStatus) => void): VoidFunction;
  /**
   * Drop the inner socket of every active provider that supports pausing
   * (e.g. providers built via `createWsJsonRpcProvider`). Clients and
   * refcounts are preserved; tracked subscriptions are re-sent on
   * {@link resumeAll} via the replay wrapper, so server-side
   * chainHead_follow state cannot accumulate across silent reconnects.
   */
  pauseAll(): void;
  resumeAll(): void;
};

type PausableLike = { pause: () => void; resume: () => void };

const isPausable = (provider: JsonRpcProvider): provider is JsonRpcProvider & PausableLike => {
  const maybe = provider as unknown as Partial<PausableLike>;
  return typeof maybe.pause === 'function' && typeof maybe.resume === 'function';
};

export const createChainConnection = <C extends ChainConfig, T = PolkadotClient>({
  resolve,
  clientOptions,
  createProvider,
  destroyDelay = 0,
}: ChainConnectionConfig<C, T>): ChainConnection<C, T> => {
  const connections = createConnectionManager();
  const refCounter = createRefCounter<string>();
  const existingClients = new Map<string, PooledClient>();

  // Resolve cache (when config.resolve is provided)
  const resolvedApis = new Map<string, { resolved: T; polkadotClient: PolkadotClient }>();
  const pendingResolutions = new Map<string, { promise: Promise<T>; polkadotClient: PolkadotClient }>();
  const destructionTimers = new Map<string, ReturnType<typeof setTimeout>>();

  const cancelDestructionTimer = (genesisHash: string) => {
    const timer = destructionTimers.get(genesisHash);
    if (timer !== undefined) {
      clearTimeout(timer);
      destructionTimers.delete(genesisHash);
    }
  };

  const getOrCreateClient = (chain: C): PooledClient => {
    const existing = existingClients.get(chain.genesisHash);
    if (existing) return existing;

    const rawProvider = createProvider(chain, status => connections.update(chain.genesisHash, status));
    const branchedProvider = createBranchedProvider(rawProvider);
    const client = createClient(branchedProvider.branch(), clientOptions?.(chain));

    const pooled: PooledClient = { client, provider: branchedProvider, rawProvider };
    existingClients.set(chain.genesisHash, pooled);
    return pooled;
  };

  const destroyClient = (genesisHash: string) => {
    cancelDestructionTimer(genesisHash);

    const pooled = existingClients.get(genesisHash);
    if (pooled) {
      existingClients.delete(genesisHash);
      connections.update(genesisHash, 'disconnected');
      pooled.client.destroy();
    }
    resolvedApis.delete(genesisHash);
    pendingResolutions.delete(genesisHash);
  };

  const rawAcquire = async (chain: C) => {
    try {
      if (destroyDelay > 0) cancelDestructionTimer(chain.genesisHash);

      refCounter.increment(chain.genesisHash);
      const pooled = getOrCreateClient(chain);

      return {
        pooled,
        unlock() {
          if (refCounter.decrement(chain.genesisHash) === 0) {
            if (destroyDelay === 0) {
              destroyClient(chain.genesisHash);
            } else {
              const timer = setTimeout(() => {
                destroyClient(chain.genesisHash);
              }, destroyDelay);
              destructionTimers.set(chain.genesisHash, timer);
            }
          }
        },
      };
    } catch (error) {
      if (refCounter.decrement(chain.genesisHash) === 0) {
        destroyClient(chain.genesisHash);
      }
      throw error;
    }
  };

  const resolveApi = async (chain: C, polkadotClient: PolkadotClient): Promise<T> => {
    if (!resolve) return polkadotClient as unknown as T;

    const existing = resolvedApis.get(chain.genesisHash);
    if (existing && existing.polkadotClient === polkadotClient) return existing.resolved;

    const pending = pendingResolutions.get(chain.genesisHash);
    if (pending && pending.polkadotClient === polkadotClient) return pending.promise;

    const promise = (async () => {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- guarded by early return above
      const resolved = await resolve!(chain, polkadotClient);
      resolvedApis.set(chain.genesisHash, { resolved, polkadotClient });
      return resolved;
    })();

    pendingResolutions.set(chain.genesisHash, { promise, polkadotClient });
    promise.finally(() => pendingResolutions.delete(chain.genesisHash));
    return promise;
  };

  return {
    async lockApi(chain) {
      const { pooled, unlock } = await rawAcquire(chain);

      try {
        const api = await resolveApi(chain, pooled.client);
        return { api, unlock };
      } catch (error) {
        unlock();
        resolvedApis.delete(chain.genesisHash);
        pendingResolutions.delete(chain.genesisHash);
        throw error;
      }
    },

    getProvider(chain) {
      return getSyncProvider(onResult => {
        rawAcquire(chain)
          .then(({ pooled, unlock }) => {
            onResult((onMessage, _onHalt) => pooled.provider.branch(unlock)(onMessage));
          })
          .catch(() => {
            onResult(null);
          });

        return () => {
          /* empty */
        };
      });
    },

    status(genesisHash) {
      return connections.getConnectionStatus(genesisHash);
    },

    onStatusChanged(genesisHash, callback) {
      return connections.onStatusChange(genesisHash, callback);
    },

    pauseAll() {
      for (const { rawProvider } of existingClients.values()) {
        if (isPausable(rawProvider)) rawProvider.pause();
      }
    },

    resumeAll() {
      for (const { rawProvider } of existingClients.values()) {
        if (isPausable(rawProvider)) rawProvider.resume();
      }
    },
  };
};
