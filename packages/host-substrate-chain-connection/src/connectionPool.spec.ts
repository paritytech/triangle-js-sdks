import type { JsonRpcProvider } from '@polkadot-api/json-rpc-provider';
import type { PolkadotClient } from 'polkadot-api';
import { describe, expect, it, vi } from 'vitest';

import type { ChainConnectionConfig } from './connectionPool.js';
import { createChainConnection } from './connectionPool.js';
import type { ChainConfig, ConnectionStatus } from './types.js';

vi.mock('polkadot-api', () => ({
  createClient: vi.fn((_provider: JsonRpcProvider, _options?: unknown) => createMockClient()),
}));

type TestChain = ChainConfig & { chainId: string };

const createMockClient = (): PolkadotClient =>
  ({
    getBestBlocks: vi.fn().mockResolvedValue([]),
    destroy: vi.fn(),
  }) as unknown as PolkadotClient;

const createMockProvider = () => {
  const send = vi.fn();
  const disconnect = vi.fn();
  let onMessage: ((msg: string) => void) | null = null;

  const provider: JsonRpcProvider = cb => {
    onMessage = cb;
    return { send, disconnect };
  };

  return { provider, send, disconnect, simulateMessage: (msg: string) => onMessage?.(msg) };
};

const testChain = (id: string): TestChain => ({ chainId: id, nodes: [{ url: 'wss://test' }] });

const createTestConnection = (overrides?: Partial<ChainConnectionConfig<TestChain>>) => {
  const mockProvider = createMockProvider();

  const connection = createChainConnection<TestChain>({
    createProvider: () => mockProvider.provider,
    ...overrides,
  });

  return { connection, mockProvider };
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

    it('calls getBestBlocks to verify connectivity', async () => {
      const { connection } = createTestConnection();
      const { api, unlock } = await connection.lockApi(testChain('a'));

      expect((api as unknown as PolkadotClient).getBestBlocks).toHaveBeenCalled();
      unlock();
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
    it('throws when getBestBlocks rejects', async () => {
      vi.mocked(await import('polkadot-api')).createClient.mockReturnValueOnce({
        getBestBlocks: vi.fn().mockRejectedValue(new Error('connection failed')),
        destroy: vi.fn(),
      } as unknown as PolkadotClient);

      const { connection } = createTestConnection();

      await expect(connection.lockApi(testChain('a'))).rejects.toThrow('connection failed');
    });

    it('destroys client on error when ref count reaches 0', async () => {
      const destroyFn = vi.fn();
      vi.mocked(await import('polkadot-api')).createClient.mockReturnValueOnce({
        getBestBlocks: vi.fn().mockRejectedValue(new Error('fail')),
        destroy: destroyFn,
      } as unknown as PolkadotClient);

      const { connection } = createTestConnection();

      await expect(connection.lockApi(testChain('a'))).rejects.toThrow();
      expect(destroyFn).toHaveBeenCalled();
    });

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

  describe('requestApi', () => {
    it('calls callback with api and returns result', async () => {
      const { connection } = createTestConnection();
      const result = await connection.requestApi(testChain('a'), api => {
        expect(api).toBeDefined();
        return 42;
      });

      expect(result).toBe(42);
    });

    it('unlocks after callback completes', async () => {
      const { connection } = createTestConnection();

      await connection.requestApi(testChain('a'), () => 'done');
      // Subsequent request should work without issue
      const result = await connection.requestApi(testChain('a'), () => 'again');
      expect(result).toBe('again');
    });

    it('unlocks when callback throws', async () => {
      const { connection } = createTestConnection();

      await expect(
        connection.requestApi(testChain('a'), () => {
          throw new Error('callback error');
        }),
      ).rejects.toThrow('callback error');

      // Should still work after error
      const result = await connection.requestApi(testChain('a'), () => 'ok');
      expect(result).toBe('ok');
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
});
