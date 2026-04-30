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

const lastSentId = (mock: ReturnType<typeof createMockProvider>): string => {
  const last = mock.send.mock.calls[mock.send.mock.calls.length - 1]?.[0] as { id: string };
  return last.id;
};

describe('chainConnectionManager', () => {
  describe('stop event handling', () => {
    it('clears chainSubId on a synthetic stop so getChainFollowSubId returns null', () => {
      const mock = createMockProvider();
      const manager = createChainConnectionManager(() => mock.provider);
      const events: unknown[] = [];

      manager.getOrCreateChain(GENESIS);
      manager.startFollow(GENESIS, true, e => events.push(e));

      const followRequestId = lastSentId(mock);
      mock.simulateMessage({ jsonrpc: '2.0', id: followRequestId, result: 'sub-id-1' });
      expect(manager.getChainFollowSubId(GENESIS)).toBe('sub-id-1');

      mock.simulateMessage({
        jsonrpc: '2.0',
        method: 'chainHead_v1_followEvent',
        params: { subscription: 'sub-id-1', result: { event: 'stop' } },
      });

      expect(manager.getChainFollowSubId(GENESIS)).toBeNull();
      expect(events).toEqual([{ event: 'stop' }]);
    });

    it('does not target the dead subId for ops issued between stop and the papp refollow', () => {
      const mock = createMockProvider();
      const manager = createChainConnectionManager(() => mock.provider);

      manager.getOrCreateChain(GENESIS);
      manager.startFollow(GENESIS, true, vi.fn());
      mock.simulateMessage({ jsonrpc: '2.0', id: lastSentId(mock), result: 'sub-id-1' });

      mock.simulateMessage({
        jsonrpc: '2.0',
        method: 'chainHead_v1_followEvent',
        params: { subscription: 'sub-id-1', result: { event: 'stop' } },
      });

      // The host-container would now check getChainFollowSubId before issuing
      // chainHead_v1_storage / _body / _call. With chainSubId cleared, the
      // caller short-circuits with a clean error rather than sending the op
      // against a server that no longer knows that subscription.
      expect(manager.getChainFollowSubId(GENESIS)).toBeNull();
    });

    it('a fresh follow after a stop is tracked under its new chainSubId', () => {
      const mock = createMockProvider();
      const manager = createChainConnectionManager(() => mock.provider);

      manager.getOrCreateChain(GENESIS);
      manager.startFollow(GENESIS, true, vi.fn());
      mock.simulateMessage({ jsonrpc: '2.0', id: lastSentId(mock), result: 'sub-id-1' });

      mock.simulateMessage({
        jsonrpc: '2.0',
        method: 'chainHead_v1_followEvent',
        params: { subscription: 'sub-id-1', result: { event: 'stop' } },
      });

      manager.startFollow(GENESIS, true, vi.fn());
      mock.simulateMessage({ jsonrpc: '2.0', id: lastSentId(mock), result: 'sub-id-2' });

      expect(manager.getChainFollowSubId(GENESIS)).toBe('sub-id-2');
    });

    it('non-stop notifications still pass through with chainSubId intact', () => {
      const mock = createMockProvider();
      const manager = createChainConnectionManager(() => mock.provider);
      const events: unknown[] = [];

      manager.getOrCreateChain(GENESIS);
      manager.startFollow(GENESIS, true, e => events.push(e));
      mock.simulateMessage({ jsonrpc: '2.0', id: lastSentId(mock), result: 'sub-id-1' });

      const newBlock = { event: 'newBlock', blockHash: '0xdead', parentBlockHash: '0xbeef' };
      mock.simulateMessage({
        jsonrpc: '2.0',
        method: 'chainHead_v1_followEvent',
        params: { subscription: 'sub-id-1', result: newBlock },
      });

      expect(events).toEqual([newBlock]);
      expect(manager.getChainFollowSubId(GENESIS)).toBe('sub-id-1');
    });
  });

  describe('basic flows', () => {
    it('sendRequest resolves on matching response', async () => {
      const mock = createMockProvider();
      const manager = createChainConnectionManager(() => mock.provider);
      manager.getOrCreateChain(GENESIS);

      const promise = manager.sendRequest(GENESIS, 'chainHead_v1_header', ['sub-1', '0xhash']);
      mock.simulateMessage({ jsonrpc: '2.0', id: lastSentId(mock), result: '0xheader' });

      await expect(promise).resolves.toBe('0xheader');
    });

    it('sendRequest rejects on error response', async () => {
      const mock = createMockProvider();
      const manager = createChainConnectionManager(() => mock.provider);
      manager.getOrCreateChain(GENESIS);

      const promise = manager.sendRequest(GENESIS, 'chainHead_v1_header', ['sub-1', '0xhash']);
      mock.simulateMessage({
        jsonrpc: '2.0',
        id: lastSentId(mock),
        error: { code: -32000, message: 'No active follow for this chain' },
      });

      await expect(promise).rejects.toEqual({ code: -32000, message: 'No active follow for this chain' });
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
  });
});
