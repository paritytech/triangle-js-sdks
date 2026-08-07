import type { JsonRpcProvider, PolkadotClient } from 'polkadot-api';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ChainConnectionConfig } from './connectionPool.js';
import { createChainConnection } from './connectionPool.js';
import type { ChainConfig, ConnectionStatus } from './types.js';

// An in-memory stand-in for polkadot-api's `createClient`: one client object per
// call, each counting its own `destroy()`.
const createClientFactory = () => {
  const clients: { destroyed: number }[] = [];

  const factory = ((_provider: JsonRpcProvider, _options?: unknown) => {
    const client = { destroyed: 0 };
    clients.push(client);

    return { destroy: () => client.destroyed++ } as unknown as PolkadotClient;
  }) as ChainConnectionConfig<ChainConfig>['createClient'];

  return { createClient: factory, last: () => clients[clients.length - 1]! };
};

const createMockProvider = () => {
  const send = vi.fn();
  const disconnect = vi.fn();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let onMessage: ((msg: any) => void) | null = null;

  const provider: JsonRpcProvider = cb => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onMessage = cb as any;
    return { send, disconnect };
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { provider, send, disconnect, simulateMessage: (msg: any) => onMessage?.(msg) };
};

const testChain = (id: string): ChainConfig => ({ genesisHash: id });

const createTestConnection = (overrides?: Partial<ChainConnectionConfig<ChainConfig>>) => {
  const mockProvider = createMockProvider();
  const clientFactory = createClientFactory();

  const connection = createChainConnection<ChainConfig>({
    createProvider: () => mockProvider.provider,
    createClient: clientFactory.createClient,
    ...overrides,
  });

  return { connection, mockProvider, clients: clientFactory };
};

describe('createChainConnection', () => {
  describe('lockApi', () => {
    it('returns api and unlock function', async () => {
      const { connection } = createTestConnection();
      const { api, unlock } = await connection.lockApi(testChain('a'));

      expect(api).toBeDefined();
      expect(typeof unlock).toBe('function');
      unlock();
    });

    it('reuses client for same chainId', async () => {
      const { connection } = createTestConnection();
      const chain = testChain('a');

      const { api: api1, unlock: u1 } = await connection.lockApi(chain);
      const { api: api2, unlock: u2 } = await connection.lockApi(chain);

      expect(api1).toBe(api2);
      u1();
      u2();
    });

    it('creates separate clients for different chains', async () => {
      const { connection } = createTestConnection();

      const { api: api1, unlock: u1 } = await connection.lockApi(testChain('a'));
      const { api: api2, unlock: u2 } = await connection.lockApi(testChain('b'));

      expect(api1).not.toBe(api2);
      u1();
      u2();
    });
  });

  describe('lockApi — with resolve', () => {
    it('calls resolve with chain and polkadotClient', async () => {
      const resolve = vi.fn().mockResolvedValue('resolved-api');
      const { connection } = createTestConnection({ resolve });
      const chain = testChain('a');

      const { api, unlock } = await connection.lockApi(chain);

      expect(api).toBe('resolved-api');
      expect(resolve).toHaveBeenCalledWith(chain, expect.anything());
      unlock();
    });

    it('caches resolved api for subsequent calls', async () => {
      const resolve = vi.fn().mockResolvedValue('resolved-api');
      const { connection } = createTestConnection({ resolve });
      const chain = testChain('a');

      const { unlock: u1 } = await connection.lockApi(chain);
      const { unlock: u2 } = await connection.lockApi(chain);

      expect(resolve).toHaveBeenCalledTimes(1);
      u1();
      u2();
    });

    it('deduplicates concurrent resolutions', async () => {
      const resolve = vi.fn().mockImplementation(() => new Promise(r => setTimeout(() => r('resolved-api'), 10)));
      const { connection } = createTestConnection({ resolve });
      const chain = testChain('a');

      const [r1, r2] = await Promise.all([connection.lockApi(chain), connection.lockApi(chain)]);

      expect(resolve).toHaveBeenCalledTimes(1);
      r1.unlock();
      r2.unlock();
    });
  });

  describe('lockApi — error handling', () => {
    it('throws when resolve rejects and calls unlock', async () => {
      const resolve = vi.fn().mockRejectedValue(new Error('resolve failed'));
      const { connection } = createTestConnection({ resolve });

      // Suppress the unhandled rejection from the detached .finally() promise chain
      // in connectionPool.ts (pendingResolutions cleanup).
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      const suppress = () => {};
      process.on('unhandledRejection', suppress);

      await expect(connection.lockApi(testChain('a'))).rejects.toThrow('resolve failed');

      // Let microtask queue flush so the .finally() settles
      await new Promise(r => setTimeout(r, 0));
      process.off('unhandledRejection', suppress);

      // After resolve failure with last ref released, new lock should create fresh client
      resolve.mockResolvedValue('recovered');
      const { api, unlock } = await connection.lockApi(testChain('a'));
      expect(api).toBe('recovered');
      unlock();
    });
  });

  describe('status / onStatusChanged', () => {
    it('returns disconnected for unknown chain', () => {
      const { connection } = createTestConnection();
      expect(connection.status('unknown')).toBe('disconnected');
    });

    it('reflects status from createProvider callback', async () => {
      let statusCb: ((status: ConnectionStatus) => void) | undefined;
      const { connection } = createTestConnection({
        createProvider: (_chain, onStatusChanged) => {
          statusCb = onStatusChanged;
          return createMockProvider().provider;
        },
      });

      await connection.lockApi(testChain('a')).then(({ unlock }) => unlock());

      statusCb!('connected');
      expect(connection.status('a')).toBe('connected');
    });

    it('onStatusChanged returns unsubscribe function', async () => {
      let statusCb: ((status: ConnectionStatus) => void) | undefined;
      const { connection } = createTestConnection({
        createProvider: (_chain, onStatusChanged) => {
          statusCb = onStatusChanged;
          return createMockProvider().provider;
        },
      });

      await connection.lockApi(testChain('a')).then(({ unlock }) => unlock());

      const callback = vi.fn();
      const unsub = connection.onStatusChanged('a', callback);

      statusCb!('connected');
      expect(callback).toHaveBeenCalledWith('connected');

      unsub();
      callback.mockClear();
      statusCb!('disconnected');
      expect(callback).not.toHaveBeenCalled();
    });
  });

  describe('lockApi — connection lifecycle', () => {
    it('destroys client synchronously when last lock is released (no destroyDelay)', async () => {
      const { connection, clients } = createTestConnection();
      const { unlock } = await connection.lockApi(testChain('a'));

      unlock();
      expect(clients.last().destroyed).toBe(1);
    });

    it('does not destroy while any lock is still held', async () => {
      const { connection, clients } = createTestConnection();
      const chain = testChain('a');
      const { unlock: u1 } = await connection.lockApi(chain);
      const { unlock: u2 } = await connection.lockApi(chain);

      u1();
      expect(clients.last().destroyed).toBe(0);

      u2();
      expect(clients.last().destroyed).toBe(1);
    });

    describe('with destroyDelay', () => {
      beforeEach(() => {
        vi.useFakeTimers();
      });
      afterEach(() => {
        vi.useRealTimers();
      });

      it('defers destruction by destroyDelay ms', async () => {
        const { connection, clients } = createTestConnection({ destroyDelay: 1000 });
        const { unlock } = await connection.lockApi(testChain('a'));

        unlock();
        expect(clients.last().destroyed).toBe(0);

        vi.advanceTimersByTime(1000);
        expect(clients.last().destroyed).toBe(1);
      });

      it('cancels destruction timer when connection is re-acquired before delay elapses', async () => {
        const { connection, clients } = createTestConnection({ destroyDelay: 1000 });
        const chain = testChain('a');

        const { api: api1, unlock: u1 } = await connection.lockApi(chain);
        u1();

        // Re-acquire before timer fires — same client must be returned, no destruction
        const { api: api2, unlock: u2 } = await connection.lockApi(chain);

        vi.advanceTimersByTime(1000);
        expect(clients.last().destroyed).toBe(0);
        expect(api1).toBe(api2);

        u2();
      });
    });
  });

  describe('pauseAll / resumeAll', () => {
    const createPausableMockProvider = () => {
      const pause = vi.fn();
      const resume = vi.fn();
      const provider: JsonRpcProvider = Object.assign(() => ({ send: vi.fn(), disconnect: vi.fn() }), {
        pause,
        resume,
      });

      return { provider, pause, resume };
    };

    it('calls pause on every pausable provider created so far', async () => {
      const chainA = createPausableMockProvider();
      const chainB = createPausableMockProvider();
      const providerByChain: Record<string, JsonRpcProvider> = { a: chainA.provider, b: chainB.provider };

      const connection = createChainConnection<ChainConfig>({
        createProvider: chain => providerByChain[chain.genesisHash]!,
        createClient: createClientFactory().createClient,
      });

      const { unlock: u1 } = await connection.lockApi(testChain('a'));
      const { unlock: u2 } = await connection.lockApi(testChain('b'));

      connection.pauseAll();

      expect(chainA.pause).toHaveBeenCalledTimes(1);
      expect(chainB.pause).toHaveBeenCalledTimes(1);

      u1();
      u2();
    });

    it('calls resume on every pausable provider', async () => {
      const chainA = createPausableMockProvider();

      const connection = createChainConnection<ChainConfig>({
        createProvider: () => chainA.provider,
        createClient: createClientFactory().createClient,
      });
      const { unlock } = await connection.lockApi(testChain('a'));

      connection.pauseAll();
      connection.resumeAll();

      expect(chainA.resume).toHaveBeenCalledTimes(1);
      unlock();
    });

    it('skips non-pausable providers without preventing pause on the rest', async () => {
      // Mixed pool: 'a' is non-pausable, 'b' is pausable. The pausable one must
      // still receive pause/resume even though the other is silently skipped.
      const pausable = createPausableMockProvider();
      const connection = createChainConnection<ChainConfig>({
        createProvider: c => (c.genesisHash === 'b' ? pausable.provider : createMockProvider().provider),
        createClient: createClientFactory().createClient,
      });
      await connection.lockApi(testChain('a'));
      await connection.lockApi(testChain('b'));

      connection.pauseAll();
      connection.resumeAll();

      expect(pausable.pause).toHaveBeenCalledTimes(1);
      expect(pausable.resume).toHaveBeenCalledTimes(1);
    });

    it('does not call pause on providers for chains that have been destroyed', async () => {
      const chainA = createPausableMockProvider();
      const connection = createChainConnection<ChainConfig>({
        createProvider: () => chainA.provider,
        createClient: createClientFactory().createClient,
        destroyDelay: 0,
      });

      const { unlock } = await connection.lockApi(testChain('a'));
      unlock();

      connection.pauseAll();
      expect(chainA.pause).not.toHaveBeenCalled();
    });
  });
});
