import type { JsonRpcProvider } from 'polkadot-api';
import { describe, expect, it, vi } from 'vitest';

import { createPausableProvider } from './pausableProvider.js';

const createMockProvider = () => {
  type Call = {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onMessage: (msg: any) => void;
    send: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
  };

  const calls: Call[] = [];

  const provider: JsonRpcProvider = cb => {
    const send = vi.fn();
    const disconnect = vi.fn();
    calls.push({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      onMessage: cb as any,
      send,
      disconnect,
    });
    return { send, disconnect };
  };

  const at = (i: number): Call => {
    const call = calls[i];
    if (!call) throw new Error(`no call at index ${i}`);
    return call;
  };

  return {
    provider,
    calls,
    at,
    last: () => at(calls.length - 1),
  };
};

describe('createPausableProvider', () => {
  it('subscribes to the inner provider immediately when not paused', () => {
    const mock = createMockProvider();
    const pausable = createPausableProvider(mock.provider);

    pausable(vi.fn());

    expect(mock.calls).toHaveLength(1);
  });

  it('forwards send calls to the inner connection', () => {
    const mock = createMockProvider();
    const pausable = createPausableProvider(mock.provider);
    const conn = pausable(vi.fn());

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    conn.send({ jsonrpc: '2.0', id: 1, method: 'system_chain' } as any);

    expect(mock.last().send).toHaveBeenCalledWith({ jsonrpc: '2.0', id: 1, method: 'system_chain' });
  });

  it('forwards inner messages to the subscriber', () => {
    const mock = createMockProvider();
    const pausable = createPausableProvider(mock.provider);
    const onMessage = vi.fn();

    pausable(onMessage);
    mock.last().onMessage({ jsonrpc: '2.0', id: 1, result: 'ok' });

    expect(onMessage).toHaveBeenCalledWith({ jsonrpc: '2.0', id: 1, result: 'ok' });
  });

  it('disconnects the inner connection on pause', () => {
    const mock = createMockProvider();
    const pausable = createPausableProvider(mock.provider);

    pausable(vi.fn());
    const disconnect = mock.last().disconnect;

    pausable.pause();

    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  it('drops send calls while paused', () => {
    const mock = createMockProvider();
    const pausable = createPausableProvider(mock.provider);
    const conn = pausable(vi.fn());
    const initialSend = mock.last().send;

    pausable.pause();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    conn.send({ jsonrpc: '2.0', id: 99, method: 'system_chain' } as any);

    expect(initialSend).not.toHaveBeenCalled();
  });

  it('re-subscribes to the inner provider on resume', () => {
    const mock = createMockProvider();
    const pausable = createPausableProvider(mock.provider);

    pausable(vi.fn());
    pausable.pause();
    pausable.resume();

    expect(mock.calls).toHaveLength(2);
  });

  it('routes send calls to the resumed inner connection', () => {
    const mock = createMockProvider();
    const pausable = createPausableProvider(mock.provider);
    const conn = pausable(vi.fn());

    pausable.pause();
    pausable.resume();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    conn.send({ jsonrpc: '2.0', id: 2, method: 'system_chain' } as any);

    expect(mock.at(1).send).toHaveBeenCalledWith({ jsonrpc: '2.0', id: 2, method: 'system_chain' });
  });

  it('forwards messages from the resumed inner connection to the original subscriber', () => {
    const mock = createMockProvider();
    const pausable = createPausableProvider(mock.provider);
    const onMessage = vi.fn();

    pausable(onMessage);
    pausable.pause();
    pausable.resume();

    mock.at(1).onMessage({ jsonrpc: '2.0', id: 3, result: 'after-resume' });

    expect(onMessage).toHaveBeenCalledWith({ jsonrpc: '2.0', id: 3, result: 'after-resume' });
  });

  it('does nothing on redundant pause/resume', () => {
    const mock = createMockProvider();
    const pausable = createPausableProvider(mock.provider);

    pausable(vi.fn());
    pausable.resume();
    expect(mock.calls).toHaveLength(1);

    pausable.pause();
    pausable.pause();
    expect(mock.last().disconnect).toHaveBeenCalledTimes(1);
  });

  it('defers subscription while paused and attaches on resume', () => {
    const mock = createMockProvider();
    const pausable = createPausableProvider(mock.provider);

    pausable.pause();
    const conn = pausable(vi.fn());
    expect(mock.calls).toHaveLength(0);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    conn.send({ jsonrpc: '2.0', id: 1, method: 'system_chain' } as any);
    expect(mock.calls).toHaveLength(0);

    pausable.resume();
    expect(mock.calls).toHaveLength(1);
  });

  it('pauses and resumes every active subscriber', () => {
    const mock = createMockProvider();
    const pausable = createPausableProvider(mock.provider);

    pausable(vi.fn());
    pausable(vi.fn());
    expect(mock.calls).toHaveLength(2);

    pausable.pause();
    expect(mock.at(0).disconnect).toHaveBeenCalledTimes(1);
    expect(mock.at(1).disconnect).toHaveBeenCalledTimes(1);

    pausable.resume();
    expect(mock.calls).toHaveLength(4);
  });

  it('does not re-subscribe for subscribers that disconnected before resume', () => {
    const mock = createMockProvider();
    const pausable = createPausableProvider(mock.provider);

    const conn1 = pausable(vi.fn());
    pausable(vi.fn());

    conn1.disconnect();
    expect(mock.at(0).disconnect).toHaveBeenCalledTimes(1);

    pausable.pause();
    pausable.resume();

    expect(mock.calls).toHaveLength(3);
  });

  it('consumer disconnect after pause does not call inner disconnect twice', () => {
    const mock = createMockProvider();
    const pausable = createPausableProvider(mock.provider);

    const conn = pausable(vi.fn());
    pausable.pause();
    expect(mock.last().disconnect).toHaveBeenCalledTimes(1);

    conn.disconnect();
    expect(mock.last().disconnect).toHaveBeenCalledTimes(1);
  });
});
