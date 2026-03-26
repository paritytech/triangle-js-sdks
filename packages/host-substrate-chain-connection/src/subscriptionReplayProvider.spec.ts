import type { JsonRpcProvider } from '@polkadot-api/json-rpc-provider';
import { describe, expect, it, vi } from 'vitest';

import { withSubscriptionReplay } from './subscriptionReplayProvider.js';

const createMockProvider = () => {
  const send = vi.fn();
  const disconnect = vi.fn();
  let onMessage: ((msg: string) => void) | null = null;

  const provider: JsonRpcProvider = cb => {
    onMessage = cb;
    return { send, disconnect };
  };

  return {
    provider,
    send,
    disconnect,
    simulateMessage: (msg: string) => onMessage?.(msg),
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

describe('withSubscriptionReplay', () => {
  it('forwards all incoming messages to onMessage unmodified', () => {
    const mock = createMockProvider();
    const { onReconnect } = createReconnectControl();
    const onMessage = vi.fn();

    withSubscriptionReplay(mock.provider, onReconnect)(onMessage);
    mock.simulateMessage('{"jsonrpc":"2.0","id":1,"result":"0xabc"}');

    expect(onMessage).toHaveBeenCalledWith('{"jsonrpc":"2.0","id":1,"result":"0xabc"}');
  });

  it('forwards send calls to the underlying provider', () => {
    const mock = createMockProvider();
    const { onReconnect } = createReconnectControl();
    const conn = withSubscriptionReplay(mock.provider, onReconnect)(vi.fn());

    conn.send('{"id":1,"method":"chain_getBlock","params":[]}');

    expect(mock.send).toHaveBeenCalledWith('{"id":1,"method":"chain_getBlock","params":[]}');
  });

  it('does not replay non-subscription requests on reconnect', () => {
    const mock = createMockProvider();
    const control = createReconnectControl();
    const conn = withSubscriptionReplay(mock.provider, control.onReconnect)(vi.fn());

    conn.send('{"id":1,"method":"chain_getBlock","params":[]}');
    mock.send.mockClear();

    control.triggerReconnect();

    expect(mock.send).not.toHaveBeenCalled();
  });

  it('does not replay pending subscriptions (no server response yet) on reconnect', () => {
    const mock = createMockProvider();
    const control = createReconnectControl();
    const conn = withSubscriptionReplay(mock.provider, control.onReconnect)(vi.fn());

    conn.send('{"id":1,"method":"chain_subscribeNewHeads","params":[]}');
    // intentionally no simulateMessage — subscription not confirmed by server
    mock.send.mockClear();

    control.triggerReconnect();

    expect(mock.send).not.toHaveBeenCalled();
  });

  it('replays active subscriptions on reconnect', () => {
    const mock = createMockProvider();
    const control = createReconnectControl();
    const conn = withSubscriptionReplay(mock.provider, control.onReconnect)(vi.fn());
    const subscribeMsg = '{"id":1,"method":"chain_subscribeNewHeads","params":[]}';

    conn.send(subscribeMsg);
    mock.simulateMessage('{"jsonrpc":"2.0","id":1,"result":"sub-id-1"}');
    mock.send.mockClear();

    control.triggerReconnect();

    expect(mock.send).toHaveBeenCalledWith(subscribeMsg);
  });

  it('replays multiple active subscriptions on reconnect', () => {
    const mock = createMockProvider();
    const control = createReconnectControl();
    const conn = withSubscriptionReplay(mock.provider, control.onReconnect)(vi.fn());
    const msg1 = '{"id":1,"method":"chain_subscribeNewHeads","params":[]}';
    const msg2 = '{"id":2,"method":"state_subscribeStorage","params":[[]]}';

    conn.send(msg1);
    mock.simulateMessage('{"jsonrpc":"2.0","id":1,"result":"sub-id-1"}');
    conn.send(msg2);
    mock.simulateMessage('{"jsonrpc":"2.0","id":2,"result":"sub-id-2"}');
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
    const subscribeMsg = '{"id":1,"method":"chain_subscribeNewHeads","params":[]}';

    conn.send(subscribeMsg);
    mock.simulateMessage('{"jsonrpc":"2.0","id":1,"result":"old-sub-id"}');

    // First reconnect — replays and moves to pending
    control.triggerReconnect();
    // Server assigns new subscription ID
    mock.simulateMessage('{"jsonrpc":"2.0","id":1,"result":"new-sub-id"}');

    // Unsubscribing with the old ID should have no effect (old ID is no longer tracked)
    conn.send('{"id":2,"method":"chain_unsubscribeNewHeads","params":["old-sub-id"]}');
    mock.send.mockClear();

    // Second reconnect — subscription is still active (new-sub-id was not removed)
    control.triggerReconnect();

    expect(mock.send).toHaveBeenCalledWith(subscribeMsg);
  });

  it('does not replay unsubscribed subscriptions on reconnect', () => {
    const mock = createMockProvider();
    const control = createReconnectControl();
    const conn = withSubscriptionReplay(mock.provider, control.onReconnect)(vi.fn());

    conn.send('{"id":1,"method":"chain_subscribeNewHeads","params":[]}');
    mock.simulateMessage('{"jsonrpc":"2.0","id":1,"result":"sub-id-1"}');
    conn.send('{"id":2,"method":"chain_unsubscribeNewHeads","params":["sub-id-1"]}');
    mock.send.mockClear();

    control.triggerReconnect();

    expect(mock.send).not.toHaveBeenCalled();
  });

  it('clears subscriptions and calls unsubscribe on disconnect', () => {
    const mock = createMockProvider();
    const control = createReconnectControl();
    const conn = withSubscriptionReplay(mock.provider, control.onReconnect)(vi.fn());

    conn.send('{"id":1,"method":"chain_subscribeNewHeads","params":[]}');
    mock.simulateMessage('{"jsonrpc":"2.0","id":1,"result":"sub-id-1"}');

    conn.disconnect();

    expect(mock.disconnect).toHaveBeenCalledTimes(1);
    expect(control.unsubscribe).toHaveBeenCalledTimes(1);

    // reconnect after disconnect should not replay (maps were cleared)
    mock.send.mockClear();
    control.triggerReconnect();
    expect(mock.send).not.toHaveBeenCalled();
  });
});
