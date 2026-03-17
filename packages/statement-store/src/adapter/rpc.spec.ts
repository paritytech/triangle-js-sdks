import type { RequestFn } from '@novasamatech/sdk-statement';
import { describe, expect, it, vi } from 'vitest';

import type { LazyClient } from './lazyClient.js';

type OnStatement = (statement: unknown) => void;
type OnError = (error: Error) => void;
type SubEntry = { onStatement: OnStatement; onError: OnError };
const noop = vi.fn();

const subscriptions = new Map<number, SubEntry>();
let subIdCounter = 0;

const mockSubscribeStatements = vi.fn((_filter: unknown, onStatement: OnStatement, onError: OnError) => {
  const id = ++subIdCounter;
  subscriptions.set(id, { onStatement, onError });
  return () => {
    subscriptions.delete(id);
  };
});

vi.mock('@novasamatech/sdk-statement', () => ({
  createStatementSdk: () => ({
    subscribeStatements: mockSubscribeStatements,
    getStatements: vi.fn(() => Promise.resolve([])),
    submit: vi.fn(() => Promise.resolve({ status: 'new' })),
  }),
}));

// Import after mock is set up
const { createPapiStatementStoreAdapter } = await import('./rpc.js');

function makeClient(): LazyClient {
  const requestFn: RequestFn = async <Reply>(_method: string, _params: unknown[]) => undefined as Reply;

  return {
    getClient: () => {
      throw new Error('Not used');
    },
    getRequestFn: () => requestFn,
    getSubscribeFn: () => vi.fn(),
    disconnect: vi.fn(),
  };
}

function makeTopics(...hexStrings: string[]): Uint8Array[] {
  return hexStrings.map(h => {
    const bytes = h.startsWith('0x') ? h.slice(2) : h;
    const pairs = bytes.match(/.{2}/g);
    return new Uint8Array((pairs ?? []).map(b => parseInt(b, 16)));
  });
}

function emitStatement(statement: unknown) {
  for (const { onStatement } of subscriptions.values()) {
    onStatement(statement);
  }
}

function setup() {
  subscriptions.clear();
  subIdCounter = 0;
  mockSubscribeStatements.mockClear();
  return createPapiStatementStoreAdapter(makeClient());
}

describe('createPapiStatementStoreAdapter', () => {
  describe('subscribeStatements', () => {
    it('creates a subscription on first callback', () => {
      const adapter = setup();

      adapter.subscribeStatements(makeTopics('0xaa'), noop);

      expect(mockSubscribeStatements).toHaveBeenCalledTimes(1);
    });

    it('deduplicates subscriptions for same topics', () => {
      const adapter = setup();
      const topics = makeTopics('0xaa');

      adapter.subscribeStatements(topics, noop);
      adapter.subscribeStatements(topics, noop);

      expect(mockSubscribeStatements).toHaveBeenCalledTimes(1);
    });

    it('creates separate subscriptions for different topics', () => {
      const adapter = setup();

      adapter.subscribeStatements(makeTopics('0xaa'), noop);
      adapter.subscribeStatements(makeTopics('0xbb'), noop);

      expect(mockSubscribeStatements).toHaveBeenCalledTimes(2);
    });

    it('delivers statements to all callbacks for same topics', async () => {
      const adapter = setup();
      const topics = makeTopics('0xaa');
      const cb1 = vi.fn();
      const cb2 = vi.fn();

      adapter.subscribeStatements(topics, cb1);
      adapter.subscribeStatements(topics, cb2);

      emitStatement({ data: 'test' });
      await new Promise(resolve => setTimeout(resolve, 0));

      expect(cb1).toHaveBeenCalledWith([{ data: 'test' }]);
      expect(cb2).toHaveBeenCalledWith([{ data: 'test' }]);
    });

    it('unsubscribes underlying subscription when last callback removed', () => {
      const adapter = setup();
      const topics = makeTopics('0xaa');
      const cb1 = vi.fn();
      const cb2 = vi.fn();

      const unsub1 = adapter.subscribeStatements(topics, cb1);
      const unsub2 = adapter.subscribeStatements(topics, cb2);
      expect(subscriptions.size).toBe(1);

      unsub1();
      expect(subscriptions.size).toBe(1);

      unsub2();
      expect(subscriptions.size).toBe(0);
    });
  });

  describe('reconnect', () => {
    it('re-creates subscriptions via sdk', () => {
      const adapter = setup();

      adapter.subscribeStatements(makeTopics('0xaa'), noop);
      adapter.subscribeStatements(makeTopics('0xbb'), noop);
      expect(mockSubscribeStatements).toHaveBeenCalledTimes(2);

      adapter.reconnect();

      expect(mockSubscribeStatements).toHaveBeenCalledTimes(4);
    });

    it('unsubscribes old before re-creating', () => {
      const adapter = setup();

      adapter.subscribeStatements(makeTopics('0xaa'), noop);
      adapter.subscribeStatements(makeTopics('0xbb'), noop);
      expect(subscriptions.size).toBe(2);

      adapter.reconnect();

      expect(subscriptions.size).toBe(2);
    });

    it('delivers statements through new subscriptions after reconnect', async () => {
      const adapter = setup();
      const cb = vi.fn();

      adapter.subscribeStatements(makeTopics('0xaa'), cb);
      adapter.reconnect();

      emitStatement({ data: 'after-reconnect' });
      await new Promise(resolve => setTimeout(resolve, 0));

      expect(cb).toHaveBeenCalledWith([{ data: 'after-reconnect' }]);
    });

    it('does not re-create if all callbacks removed', () => {
      const adapter = setup();

      const unsub = adapter.subscribeStatements(makeTopics('0xaa'), noop);
      unsub();

      adapter.reconnect();

      expect(mockSubscribeStatements).toHaveBeenCalledTimes(1);
      expect(subscriptions.size).toBe(0);
    });

    it('preserves deduplication after reconnect', () => {
      const adapter = setup();
      const topics = makeTopics('0xaa');

      adapter.subscribeStatements(topics, noop);
      adapter.subscribeStatements(topics, noop);
      expect(mockSubscribeStatements).toHaveBeenCalledTimes(1);

      adapter.reconnect();

      expect(mockSubscribeStatements).toHaveBeenCalledTimes(2);
      expect(subscriptions.size).toBe(1);
    });

    it('unsubscribe still works after reconnect', () => {
      const adapter = setup();

      const unsub = adapter.subscribeStatements(makeTopics('0xaa'), noop);
      adapter.reconnect();
      expect(subscriptions.size).toBe(1);

      unsub();
      expect(subscriptions.size).toBe(0);
    });
  });
});
