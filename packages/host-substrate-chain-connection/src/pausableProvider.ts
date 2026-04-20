import type { JsonRpcProvider } from 'polkadot-api';

type JsonRpcConnection = ReturnType<JsonRpcProvider>;
type JsonRpcMessage = Parameters<Parameters<JsonRpcProvider>[0]>[0];

export type PausableJsonRpcProvider = JsonRpcProvider & {
  pause(): void;
  resume(): void;
};

/**
 * Intended to sit below `withSubscriptionReplay`: on `pause`/`resume` the
 * replay wrapper keeps the set of tracked subscriptions and re-sends them on
 * the fresh CONNECTED event, so server-side chainHead_follow state cannot
 * accumulate across silent WebSocket reconnects.
 */
export const createPausableProvider = (inner: JsonRpcProvider): PausableJsonRpcProvider => {
  type Subscriber = {
    onMessage: (msg: JsonRpcMessage) => void;
    conn: JsonRpcConnection | null;
  };

  let paused = false;
  const subscribers = new Set<Subscriber>();

  const provider: JsonRpcProvider = onMessage => {
    const sub: Subscriber = { onMessage, conn: null };
    subscribers.add(sub);
    if (!paused) sub.conn = inner(onMessage);

    return {
      send(message) {
        sub.conn?.send(message);
      },
      disconnect() {
        sub.conn?.disconnect();
        sub.conn = null;
        subscribers.delete(sub);
      },
    };
  };

  return Object.assign(provider, {
    pause(): void {
      if (paused) return;
      paused = true;
      for (const sub of subscribers) {
        sub.conn?.disconnect();
        sub.conn = null;
      }
    },
    resume(): void {
      if (!paused) return;
      paused = false;
      for (const sub of subscribers) {
        sub.conn = inner(sub.onMessage);
      }
    },
  });
};
