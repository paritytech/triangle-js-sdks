import type { JsonRpcProvider } from '@polkadot-api/json-rpc-provider';
import { describe, expect, it, vi } from 'vitest';

import { createBranchedProvider } from './branchedProvider.js';

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

describe('createBranchedProvider', () => {
  it('creates underlying connection on first branch', () => {
    const mock = createMockProvider();
    const branched = createBranchedProvider(mock.provider);

    const onMessage = vi.fn();
    branched.branch()(onMessage);

    mock.simulateMessage('{"id":1}');
    expect(onMessage).toHaveBeenCalledWith('{"id":1}');
  });

  it('reuses connection for multiple branches', () => {
    const mock = createMockProvider();
    const providerSpy = vi.fn(mock.provider);
    const branched = createBranchedProvider(providerSpy);

    branched.branch()(vi.fn());
    branched.branch()(vi.fn());

    expect(providerSpy).toHaveBeenCalledTimes(1);
  });

  it('broadcasts messages to all active branches', () => {
    const mock = createMockProvider();
    const branched = createBranchedProvider(mock.provider);

    const cb1 = vi.fn();
    const cb2 = vi.fn();
    branched.branch()(cb1);
    branched.branch()(cb2);

    mock.simulateMessage('{"id":1}');
    expect(cb1).toHaveBeenCalledWith('{"id":1}');
    expect(cb2).toHaveBeenCalledWith('{"id":1}');
  });

  it('disconnected branch stops receiving messages', () => {
    const mock = createMockProvider();
    const branched = createBranchedProvider(mock.provider);

    const cb1 = vi.fn();
    const conn1 = branched.branch()(cb1);
    branched.branch()(vi.fn()); // keep connection alive

    conn1.disconnect();
    mock.simulateMessage('{"id":1}');

    expect(cb1).not.toHaveBeenCalled();
  });

  it('disconnecting one branch does not affect others', () => {
    const mock = createMockProvider();
    const branched = createBranchedProvider(mock.provider);

    const conn1 = branched.branch()(vi.fn());
    const cb2 = vi.fn();
    branched.branch()(cb2);

    conn1.disconnect();
    mock.simulateMessage('{"id":1}');

    expect(cb2).toHaveBeenCalledWith('{"id":1}');
    expect(mock.disconnect).not.toHaveBeenCalled();
  });

  it('disconnecting last branch tears down underlying connection', () => {
    const mock = createMockProvider();
    const branched = createBranchedProvider(mock.provider);

    const conn1 = branched.branch()(vi.fn());
    const conn2 = branched.branch()(vi.fn());

    conn1.disconnect();
    expect(mock.disconnect).not.toHaveBeenCalled();

    conn2.disconnect();
    expect(mock.disconnect).toHaveBeenCalledTimes(1);
  });

  it('calls onDisconnect callback on branch disconnect', () => {
    const mock = createMockProvider();
    const branched = createBranchedProvider(mock.provider);

    const onDisconnect = vi.fn();
    const conn = branched.branch(onDisconnect)(vi.fn());

    conn.disconnect();
    expect(onDisconnect).toHaveBeenCalledTimes(1);
  });

  it('new branch after full teardown creates fresh connection', () => {
    const mock = createMockProvider();
    const providerSpy = vi.fn(mock.provider);
    const branched = createBranchedProvider(providerSpy);

    const conn = branched.branch()(vi.fn());
    conn.disconnect();
    expect(providerSpy).toHaveBeenCalledTimes(1);

    branched.branch()(vi.fn());
    expect(providerSpy).toHaveBeenCalledTimes(2);
  });

  it('branch.send delegates to underlying connection', () => {
    const mock = createMockProvider();
    const branched = createBranchedProvider(mock.provider);

    const conn = branched.branch()(vi.fn());
    conn.send('{"method":"test"}');

    expect(mock.send).toHaveBeenCalledWith('{"method":"test"}');
  });

  it('calls enhanceBranch for each new branch independently', () => {
    const mock = createMockProvider();
    const enhance = vi.fn((p: JsonRpcProvider) => p);
    const branched = createBranchedProvider(mock.provider, { enhanceBranch: enhance });

    branched.branch()(vi.fn());
    branched.branch()(vi.fn());

    expect(enhance).toHaveBeenCalledTimes(2);
  });
});
