import type { HexString } from '@novasamatech/host-api';
import type { JsonRpcProvider } from 'polkadot-api';
import { describe, expect, it, vi } from 'vitest';

import { createChainConnectionManager } from './chainConnectionManager.js';

const GENESIS = '0xabc' as HexString;

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

  return {
    provider,
    send,
    disconnect,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    simulateMessage: (msg: any) => onMessage?.(msg),
  };
};

const sentMessages = (
  mock: ReturnType<typeof createMockProvider>,
): Array<{ id: string; method: string; params: unknown[] }> =>
  mock.send.mock.calls.map(([msg]) => msg as { id: string; method: string; params: unknown[] });

const findCallId = (mock: ReturnType<typeof createMockProvider>, method: string): string => {
  const match = sentMessages(mock).find(msg => msg.method === method);
  if (!match) throw new Error(`no '${method}' call found`);
  return match.id;
};

describe('chainConnectionManager', () => {
  describe('startFollow / stop event handling', () => {
    it('sends chainHead_v1_follow on startFollow', () => {
      const mock = createMockProvider();
      const manager = createChainConnectionManager(() => mock.provider);

      manager.getOrCreateChain(GENESIS);
      manager.startFollow(GENESIS, true, vi.fn());

      const calls = sentMessages(mock);
      expect(calls).toHaveLength(1);
      expect(calls[0]).toMatchObject({ method: 'chainHead_v1_follow', params: [true] });
    });

    it('hasActiveFollow becomes true on startFollow and stays true through the server confirmation', () => {
      // The follow lifecycle is owned by substrate-client's chainHead, which
      // queues chain-head ops on the underlying followSubscription Promise
      // until the server assigns a chainSubId. So a follow is "active" from
      // the moment startFollow returns; ops issued in the setup window are
      // not rejected — they queue and fire once the chainSubId arrives.
      const mock = createMockProvider();
      const manager = createChainConnectionManager(() => mock.provider);

      manager.getOrCreateChain(GENESIS);
      manager.startFollow(GENESIS, true, vi.fn());
      expect(manager.hasActiveFollow(GENESIS)).toBe(true);

      mock.simulateMessage({ jsonrpc: '2.0', id: findCallId(mock, 'chainHead_v1_follow'), result: 'sub-id-1' });
      expect(manager.hasActiveFollow(GENESIS)).toBe(true);
    });

    it('forwards a synthetic stop event to the listener and clears hasActiveFollow', () => {
      const mock = createMockProvider();
      const manager = createChainConnectionManager(() => mock.provider);
      const events: unknown[] = [];

      manager.getOrCreateChain(GENESIS);
      manager.startFollow(GENESIS, true, e => events.push(e));
      mock.simulateMessage({ jsonrpc: '2.0', id: findCallId(mock, 'chainHead_v1_follow'), result: 'sub-id-1' });

      mock.simulateMessage({
        jsonrpc: '2.0',
        method: 'chainHead_v1_followEvent',
        params: { subscription: 'sub-id-1', result: { event: 'stop' } },
      });

      expect(events).toEqual([{ event: 'stop' }]);
      expect(manager.hasActiveFollow(GENESIS)).toBe(false);
    });

    it('forwards initialized/newBlock follow events with the spec-shape `event` field restored', () => {
      const mock = createMockProvider();
      const manager = createChainConnectionManager(() => mock.provider);
      const events: unknown[] = [];

      manager.getOrCreateChain(GENESIS);
      manager.startFollow(GENESIS, true, e => events.push(e));
      mock.simulateMessage({ jsonrpc: '2.0', id: findCallId(mock, 'chainHead_v1_follow'), result: 'sub-id-1' });

      mock.simulateMessage({
        jsonrpc: '2.0',
        method: 'chainHead_v1_followEvent',
        params: {
          subscription: 'sub-id-1',
          result: {
            event: 'initialized',
            finalizedBlockHashes: ['0xdead'],
            finalizedBlockRuntime: {
              type: 'valid',
              spec: { specName: 'x', implName: 'y', specVersion: 1, implVersion: 1, apis: {} },
            },
          },
        },
      });

      expect(events).toEqual([
        expect.objectContaining({
          event: 'initialized',
          finalizedBlockHashes: ['0xdead'],
        }),
      ]);
    });

    it('drops the dead follow entry on stop so it does not leak as a tombstone', () => {
      const mock = createMockProvider();
      const manager = createChainConnectionManager(() => mock.provider);

      manager.getOrCreateChain(GENESIS);
      const { followId } = manager.startFollow(GENESIS, true, vi.fn());
      mock.simulateMessage({ jsonrpc: '2.0', id: findCallId(mock, 'chainHead_v1_follow'), result: 'sub-id-1' });

      mock.simulateMessage({
        jsonrpc: '2.0',
        method: 'chainHead_v1_followEvent',
        params: { subscription: 'sub-id-1', result: { event: 'stop' } },
      });

      // stopFollow on the now-dead followId is a no-op (entry already cleaned
      // up). The unfollow RPC must NOT be sent — the follow is already gone.
      const beforeStop = sentMessages(mock).length;
      manager.stopFollow(GENESIS, followId);
      expect(sentMessages(mock)).toHaveLength(beforeStop);
    });

    it('a fresh follow after a stop is tracked under its new chainSubId', () => {
      const mock = createMockProvider();
      const manager = createChainConnectionManager(() => mock.provider);

      manager.getOrCreateChain(GENESIS);
      manager.startFollow(GENESIS, true, vi.fn());
      mock.simulateMessage({ jsonrpc: '2.0', id: findCallId(mock, 'chainHead_v1_follow'), result: 'sub-id-1' });

      mock.simulateMessage({
        jsonrpc: '2.0',
        method: 'chainHead_v1_followEvent',
        params: { subscription: 'sub-id-1', result: { event: 'stop' } },
      });
      expect(manager.hasActiveFollow(GENESIS)).toBe(false);

      manager.startFollow(GENESIS, true, vi.fn());
      const followCalls = sentMessages(mock).filter(m => m.method === 'chainHead_v1_follow');
      expect(followCalls).toHaveLength(2);

      mock.simulateMessage({ jsonrpc: '2.0', id: followCalls[1]!.id, result: 'sub-id-2' });
      expect(manager.hasActiveFollow(GENESIS)).toBe(true);
    });
  });

  describe('chainHeadOp', () => {
    it('rejects with "No active follow for this chain" when no follow is active', async () => {
      const mock = createMockProvider();
      const manager = createChainConnectionManager(() => mock.provider);

      manager.getOrCreateChain(GENESIS);
      // No startFollow.

      await expect(manager.chainHeadOp(GENESIS, 'chainHead_v1_header', ['0xhash'])).rejects.toThrow(
        'No active follow for this chain',
      );
    });

    it('rejects after the refollow timeout elapses with no fresh Follow', async () => {
      const mock = createMockProvider();
      const manager = createChainConnectionManager(() => mock.provider, { refollowTimeoutMs: 30 });

      manager.getOrCreateChain(GENESIS);
      manager.startFollow(GENESIS, true, vi.fn());
      mock.simulateMessage({ jsonrpc: '2.0', id: findCallId(mock, 'chainHead_v1_follow'), result: 'sub-id-1' });

      mock.simulateMessage({
        jsonrpc: '2.0',
        method: 'chainHead_v1_followEvent',
        params: { subscription: 'sub-id-1', result: { event: 'stop' } },
      });

      await expect(manager.chainHeadOp(GENESIS, 'chainHead_v1_header', ['0xhash'])).rejects.toThrow(
        'No active follow for this chain',
      );
    });

    it('still queues when the papp closes its dead subscription before opening a new one', async () => {
      // Recovery window is gated on the most recent Stop, not on whether an
      // entry happens to remain in the follows map. So even if the papp's
      // pattern is "stopFollow on the old subscription, then startFollow on
      // a new one", ops issued in the gap still queue.
      const mock = createMockProvider();
      const manager = createChainConnectionManager(() => mock.provider, { refollowTimeoutMs: 1_000 });

      manager.getOrCreateChain(GENESIS);
      const { followId } = manager.startFollow(GENESIS, true, vi.fn());
      mock.simulateMessage({ jsonrpc: '2.0', id: findCallId(mock, 'chainHead_v1_follow'), result: 'sub-id-1' });

      mock.simulateMessage({
        jsonrpc: '2.0',
        method: 'chainHead_v1_followEvent',
        params: { subscription: 'sub-id-1', result: { event: 'stop' } },
      });

      // Papp closes its OLD subscription on Stop, BEFORE opening NEW.
      manager.stopFollow(GENESIS, followId);

      // Op issued in the gap must queue, not fail fast.
      const opPromise = manager.chainHeadOp(GENESIS, 'chainHead_v1_header', ['0xhash']);
      expect(sentMessages(mock).find(m => m.method === 'chainHead_v1_header')).toBeUndefined();

      manager.startFollow(GENESIS, true, vi.fn());
      const newFollowId = sentMessages(mock).filter(m => m.method === 'chainHead_v1_follow')[1]!.id;
      mock.simulateMessage({ jsonrpc: '2.0', id: newFollowId, result: 'sub-id-2' });
      await Promise.resolve();

      const headerCall = sentMessages(mock).find(m => m.method === 'chainHead_v1_header');
      expect(headerCall?.params).toEqual(['sub-id-2', '0xhash']);
      mock.simulateMessage({ jsonrpc: '2.0', id: headerCall!.id, result: '0xheader' });
      await expect(opPromise).resolves.toBe('0xheader');
    });

    it('queues a chain-head op issued in the stop→refollow gap and drains it into the new follow', async () => {
      const mock = createMockProvider();
      const manager = createChainConnectionManager(() => mock.provider, { refollowTimeoutMs: 1_000 });

      manager.getOrCreateChain(GENESIS);
      manager.startFollow(GENESIS, true, vi.fn());
      const firstFollowId = findCallId(mock, 'chainHead_v1_follow');
      mock.simulateMessage({ jsonrpc: '2.0', id: firstFollowId, result: 'sub-id-1' });

      // Stop invalidates the first follow but leaves the entry around so ops can queue.
      mock.simulateMessage({
        jsonrpc: '2.0',
        method: 'chainHead_v1_followEvent',
        params: { subscription: 'sub-id-1', result: { event: 'stop' } },
      });

      // Op issued while no follow is active — should not fail immediately.
      const opPromise = manager.chainHeadOp(GENESIS, 'chainHead_v1_header', ['0xhash']);

      // No header request hit the wire yet (still queued).
      expect(sentMessages(mock).find(m => m.method === 'chainHead_v1_header')).toBeUndefined();

      // Papp issues a fresh Follow.
      manager.startFollow(GENESIS, true, vi.fn());
      const secondFollowId = sentMessages(mock).filter(m => m.method === 'chainHead_v1_follow')[1]!.id;
      mock.simulateMessage({ jsonrpc: '2.0', id: secondFollowId, result: 'sub-id-2' });

      // The queued op drains into the new follow on the next microtask
      // (substrate-client's fRequest waits on the followSubscription Promise).
      await Promise.resolve();

      const headerCall = sentMessages(mock).find(m => m.method === 'chainHead_v1_header');
      expect(headerCall?.params).toEqual(['sub-id-2', '0xhash']);

      mock.simulateMessage({ jsonrpc: '2.0', id: headerCall!.id, result: '0xheader' });
      await expect(opPromise).resolves.toBe('0xheader');
    });

    it('rejects queued ops when the chain is disposed before a refollow', async () => {
      const mock = createMockProvider();
      const manager = createChainConnectionManager(() => mock.provider, { refollowTimeoutMs: 1_000 });

      manager.getOrCreateChain(GENESIS);
      manager.startFollow(GENESIS, true, vi.fn());
      mock.simulateMessage({ jsonrpc: '2.0', id: findCallId(mock, 'chainHead_v1_follow'), result: 'sub-id-1' });

      mock.simulateMessage({
        jsonrpc: '2.0',
        method: 'chainHead_v1_followEvent',
        params: { subscription: 'sub-id-1', result: { event: 'stop' } },
      });

      const opPromise = manager.chainHeadOp(GENESIS, 'chainHead_v1_header', ['0xhash']);
      manager.releaseChain(GENESIS);

      await expect(opPromise).rejects.toThrow('Chain disposed');
    });

    it('auto-prepends the chainSubId when forwarding a chain-head op to the provider', async () => {
      const mock = createMockProvider();
      const manager = createChainConnectionManager(() => mock.provider);

      manager.getOrCreateChain(GENESIS);
      manager.startFollow(GENESIS, true, vi.fn());
      mock.simulateMessage({ jsonrpc: '2.0', id: findCallId(mock, 'chainHead_v1_follow'), result: 'sub-id-1' });

      const promise = manager.chainHeadOp(GENESIS, 'chainHead_v1_header', ['0xblockHash']);
      const headerCall = sentMessages(mock).find(m => m.method === 'chainHead_v1_header');
      expect(headerCall?.params).toEqual(['sub-id-1', '0xblockHash']);

      mock.simulateMessage({ jsonrpc: '2.0', id: headerCall!.id, result: '0xheader' });
      await expect(promise).resolves.toBe('0xheader');
    });

    it('forwards operation events streamed against the started operationId to the follow listener', async () => {
      const mock = createMockProvider();
      const manager = createChainConnectionManager(() => mock.provider);
      const events: unknown[] = [];

      manager.getOrCreateChain(GENESIS);
      manager.startFollow(GENESIS, true, e => events.push(e));
      mock.simulateMessage({ jsonrpc: '2.0', id: findCallId(mock, 'chainHead_v1_follow'), result: 'sub-id-1' });

      const promise = manager.chainHeadOp(GENESIS, 'chainHead_v1_storage', ['0xhash', [], null]);
      const storageCall = sentMessages(mock).find(m => m.method === 'chainHead_v1_storage');
      mock.simulateMessage({
        jsonrpc: '2.0',
        id: storageCall!.id,
        result: { result: 'started', operationId: 'op-1', discardedItems: 0 },
      });
      await expect(promise).resolves.toMatchObject({ result: 'started', operationId: 'op-1' });

      // Now operation events streamed via the follow notification must reach the listener.
      const items = { event: 'operationStorageItems', operationId: 'op-1', items: [] };
      mock.simulateMessage({
        jsonrpc: '2.0',
        method: 'chainHead_v1_followEvent',
        params: { subscription: 'sub-id-1', result: items },
      });
      const done = { event: 'operationStorageDone', operationId: 'op-1' };
      mock.simulateMessage({
        jsonrpc: '2.0',
        method: 'chainHead_v1_followEvent',
        params: { subscription: 'sub-id-1', result: done },
      });

      expect(events).toContainEqual(items);
      expect(events).toContainEqual(done);
    });
  });

  describe('basic flows', () => {
    it('sendRequest forwards a non-chainHead JSON-RPC and resolves on response', async () => {
      const mock = createMockProvider();
      const manager = createChainConnectionManager(() => mock.provider);
      manager.getOrCreateChain(GENESIS);

      const promise = manager.sendRequest(GENESIS, 'chainSpec_v1_genesisHash', []);
      const call = sentMessages(mock).find(m => m.method === 'chainSpec_v1_genesisHash');
      mock.simulateMessage({ jsonrpc: '2.0', id: call!.id, result: '0xgenesis' });

      await expect(promise).resolves.toBe('0xgenesis');
    });

    it('sendRequest rejects on error response', async () => {
      const mock = createMockProvider();
      const manager = createChainConnectionManager(() => mock.provider);
      manager.getOrCreateChain(GENESIS);

      const promise = manager.sendRequest(GENESIS, 'chainSpec_v1_genesisHash', []);
      const call = sentMessages(mock).find(m => m.method === 'chainSpec_v1_genesisHash');
      mock.simulateMessage({
        jsonrpc: '2.0',
        id: call!.id,
        error: { code: -32000, message: 'unsupported' },
      });

      await expect(promise).rejects.toBeInstanceOf(Error);
    });

    it('releaseChain only disconnects when refCount drops to zero', () => {
      const mock = createMockProvider();
      const manager = createChainConnectionManager(() => mock.provider);

      manager.getOrCreateChain(GENESIS);
      manager.getOrCreateChain(GENESIS);

      manager.releaseChain(GENESIS);
      expect(mock.disconnect).not.toHaveBeenCalled();

      manager.releaseChain(GENESIS);
      expect(mock.disconnect).toHaveBeenCalledTimes(1);
    });

    it('stopFollow sends chainHead_v1_unfollow with the current chainSubId', () => {
      const mock = createMockProvider();
      const manager = createChainConnectionManager(() => mock.provider);

      manager.getOrCreateChain(GENESIS);
      const { followId } = manager.startFollow(GENESIS, true, vi.fn());
      mock.simulateMessage({ jsonrpc: '2.0', id: findCallId(mock, 'chainHead_v1_follow'), result: 'sub-id-1' });

      manager.stopFollow(GENESIS, followId);

      const unfollowCall = sentMessages(mock).find(m => m.method === 'chainHead_v1_unfollow');
      expect(unfollowCall?.params).toEqual(['sub-id-1']);
      expect(manager.hasActiveFollow(GENESIS)).toBe(false);
    });
  });
});
