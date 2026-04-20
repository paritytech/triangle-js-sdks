import type { JsonRpcProvider } from 'polkadot-api';
import { describe, expect, it, vi } from 'vitest';

import { withSubscriptionReplay } from './subscriptionReplayProvider.js';

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

const createReconnectControl = () => {
  let callback: VoidFunction | null = null;
  const unsubscribe = vi.fn(() => {
    callback = null;
  });

  const onReconnect = (cb: VoidFunction) => {
    callback = cb;
    return unsubscribe;
  };

  return {
    onReconnect,
    triggerReconnect: () => callback?.(),
    unsubscribe,
  };
};

// Helper to create typed request objects
const req = (id: number, method: string, params: unknown[] = []) => ({ jsonrpc: '2.0' as const, id, method, params });
const res = (id: number, result: unknown) => ({ jsonrpc: '2.0' as const, id, result });

describe('withSubscriptionReplay', () => {
  it('forwards all incoming messages to onMessage unmodified', () => {
    const mock = createMockProvider();
    const { onReconnect } = createReconnectControl();
    const onMessage = vi.fn();

    withSubscriptionReplay(mock.provider, onReconnect)(onMessage);
    mock.simulateMessage(res(1, '0xabc'));

    expect(onMessage).toHaveBeenCalledWith(res(1, '0xabc'));
  });

  it('forwards send calls to the underlying provider', () => {
    const mock = createMockProvider();
    const { onReconnect } = createReconnectControl();
    const conn = withSubscriptionReplay(mock.provider, onReconnect)(vi.fn());

    conn.send(req(1, 'chain_getBlock') as any);

    expect(mock.send).toHaveBeenCalledWith(req(1, 'chain_getBlock'));
  });

  it('does not replay non-subscription requests on reconnect', () => {
    const mock = createMockProvider();
    const control = createReconnectControl();
    const conn = withSubscriptionReplay(mock.provider, control.onReconnect)(vi.fn());

    conn.send(req(1, 'chain_getBlock') as any);
    mock.send.mockClear();

    control.triggerReconnect();

    expect(mock.send).not.toHaveBeenCalled();
  });

  it('does not replay pending subscriptions (no server response yet) on reconnect', () => {
    const mock = createMockProvider();
    const control = createReconnectControl();
    const conn = withSubscriptionReplay(mock.provider, control.onReconnect)(vi.fn());

    conn.send(req(1, 'chain_subscribeNewHeads') as any);
    // intentionally no simulateMessage — subscription not confirmed by server
    mock.send.mockClear();

    control.triggerReconnect();

    expect(mock.send).not.toHaveBeenCalled();
  });

  it('replays active subscriptions on reconnect', () => {
    const mock = createMockProvider();
    const control = createReconnectControl();
    const conn = withSubscriptionReplay(mock.provider, control.onReconnect)(vi.fn());
    const subscribeMsg = req(1, 'chain_subscribeNewHeads');

    conn.send(subscribeMsg as any);
    mock.simulateMessage(res(1, 'sub-id-1'));
    mock.send.mockClear();

    control.triggerReconnect();

    expect(mock.send).toHaveBeenCalledWith(subscribeMsg);
  });

  it('replays multiple active subscriptions on reconnect', () => {
    const mock = createMockProvider();
    const control = createReconnectControl();
    const conn = withSubscriptionReplay(mock.provider, control.onReconnect)(vi.fn());
    const msg1 = req(1, 'chain_subscribeNewHeads');
    const msg2 = req(2, 'state_subscribeStorage', [[]]);

    conn.send(msg1 as any);
    mock.simulateMessage(res(1, 'sub-id-1'));
    conn.send(msg2 as any);
    mock.simulateMessage(res(2, 'sub-id-2'));
    mock.send.mockClear();

    control.triggerReconnect();

    expect(mock.send).toHaveBeenCalledTimes(2);
    expect(mock.send).toHaveBeenCalledWith(msg1);
    expect(mock.send).toHaveBeenCalledWith(msg2);
  });

  it('re-registers subscriptions under new server IDs after reconnect', () => {
    const mock = createMockProvider();
    const control = createReconnectControl();
    const conn = withSubscriptionReplay(mock.provider, control.onReconnect)(vi.fn());
    const subscribeMsg = req(1, 'chain_subscribeNewHeads');

    conn.send(subscribeMsg as any);
    mock.simulateMessage(res(1, 'old-sub-id'));

    // First reconnect — replays and moves to pending
    control.triggerReconnect();
    // Server assigns new subscription ID
    mock.simulateMessage(res(1, 'new-sub-id'));

    // Unsubscribing with the old ID should have no effect (old ID is no longer tracked)
    conn.send(req(2, 'chain_unsubscribeNewHeads', ['old-sub-id']) as any);
    mock.send.mockClear();

    // Second reconnect — subscription is still active (new-sub-id was not removed)
    control.triggerReconnect();

    expect(mock.send).toHaveBeenCalledWith(subscribeMsg);
  });

  it('does not replay unsubscribed subscriptions on reconnect', () => {
    const mock = createMockProvider();
    const control = createReconnectControl();
    const conn = withSubscriptionReplay(mock.provider, control.onReconnect)(vi.fn());

    conn.send(req(1, 'chain_subscribeNewHeads') as any);
    mock.simulateMessage(res(1, 'sub-id-1'));
    conn.send(req(2, 'chain_unsubscribeNewHeads', ['sub-id-1']) as any);
    mock.send.mockClear();

    control.triggerReconnect();

    expect(mock.send).not.toHaveBeenCalled();
  });

  it('clears subscriptions and calls unsubscribe on disconnect', () => {
    const mock = createMockProvider();
    const control = createReconnectControl();
    const conn = withSubscriptionReplay(mock.provider, control.onReconnect)(vi.fn());

    conn.send(req(1, 'chain_subscribeNewHeads') as any);
    mock.simulateMessage(res(1, 'sub-id-1'));

    conn.disconnect();

    expect(mock.disconnect).toHaveBeenCalledTimes(1);
    expect(control.unsubscribe).toHaveBeenCalledTimes(1);

    // reconnect after disconnect should not replay (maps were cleared)
    mock.send.mockClear();
    control.triggerReconnect();
    expect(mock.send).not.toHaveBeenCalled();
  });

  it('does not replay chainHead_v1_follow when pending (no server response yet)', () => {
    const mock = createMockProvider();
    const control = createReconnectControl();
    const conn = withSubscriptionReplay(mock.provider, control.onReconnect)(vi.fn());

    conn.send(req(1, 'chainHead_v1_follow', [true]) as any);
    // intentionally no simulateMessage — subscription not confirmed by server
    mock.send.mockClear();

    control.triggerReconnect();

    expect(mock.send).not.toHaveBeenCalled();
  });

  it('replays active chainHead_v1_follow subscription on reconnect', () => {
    const mock = createMockProvider();
    const control = createReconnectControl();
    const conn = withSubscriptionReplay(mock.provider, control.onReconnect)(vi.fn());
    const followMsg = req(1, 'chainHead_v1_follow', [true]);

    conn.send(followMsg as any);
    mock.simulateMessage(res(1, 'follow-sub-id'));
    mock.send.mockClear();

    control.triggerReconnect();

    expect(mock.send).toHaveBeenCalledWith(followMsg);
  });

  it('does not replay chainHead_v1_follow after chainHead_v1_unfollow', () => {
    const mock = createMockProvider();
    const control = createReconnectControl();
    const conn = withSubscriptionReplay(mock.provider, control.onReconnect)(vi.fn());

    conn.send(req(1, 'chainHead_v1_follow', [true]) as any);
    mock.simulateMessage(res(1, 'follow-sub-id'));
    conn.send(req(2, 'chainHead_v1_unfollow', ['follow-sub-id']) as any);
    mock.send.mockClear();

    control.triggerReconnect();

    expect(mock.send).not.toHaveBeenCalled();
  });

  it('keeps chainHead_v1_follow active when chainHead_v1_unfollow uses wrong sub-id', () => {
    const mock = createMockProvider();
    const control = createReconnectControl();
    const conn = withSubscriptionReplay(mock.provider, control.onReconnect)(vi.fn());
    const followMsg = req(1, 'chainHead_v1_follow', [true]);

    conn.send(followMsg as any);
    mock.simulateMessage(res(1, 'follow-sub-id'));
    conn.send(req(2, 'chainHead_v1_unfollow', ['wrong-sub-id']) as any);
    mock.send.mockClear();

    control.triggerReconnect();

    expect(mock.send).toHaveBeenCalledWith(followMsg);
  });
});
