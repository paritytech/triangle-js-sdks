import type { JsonRpcProvider } from '@polkadot-api/json-rpc-provider';

const isSubscribeMethod = (method: string): boolean =>
  method === 'chainHead_v1_follow' ||
  (method.toLowerCase().includes('subscribe') && !method.toLowerCase().includes('unsubscribe'));

const isUnsubscribeMethod = (method: string): boolean =>
  method === 'chainHead_v1_unfollow' || method.toLowerCase().includes('unsubscribe');

export const withSubscriptionReplay =
  (provider: JsonRpcProvider, onReconnect: (callback: VoidFunction) => VoidFunction): JsonRpcProvider =>
  onMessage => {
    // request id → raw JSON message (sent, awaiting server subscription ID)
    const pendingSubscriptions = new Map<number | string, string>();
    // server subscription ID → raw JSON message (confirmed by server)
    const activeSubscriptions = new Map<string, { id: number | string; payload: string }>();

    const conn = provider(message => {
      const parsed: { id?: number | string; result?: unknown } = JSON.parse(message);

      if (parsed.id !== undefined && typeof parsed.result === 'string') {
        const pending = pendingSubscriptions.get(parsed.id);
        if (pending !== undefined) {
          pendingSubscriptions.delete(parsed.id);
          activeSubscriptions.set(parsed.result, { id: parsed.id, payload: pending });
        }
      }
      onMessage(message);
    });

    const unsubReconnect = onReconnect(() => {
      const toResend = [...activeSubscriptions.values()];
      activeSubscriptions.clear();

      for (const { id, payload } of toResend) {
        pendingSubscriptions.set(id, payload);
        conn.send(payload);
      }
    });

    return {
      send(message) {
        const { method, id, params }: { method?: string; id?: number | string; params?: unknown[] } =
          JSON.parse(message);

        if (method) {
          if (isSubscribeMethod(method)) {
            if (id !== undefined) pendingSubscriptions.set(id, message);
          } else if (isUnsubscribeMethod(method)) {
            const subId = (params as [string] | undefined)?.[0];
            // Note: callers must use the most recently received server-assigned subscription
            // ID to successfully unsubscribe. Using a stale ID from a previous connection
            // will silently fail. Additionally, if the caller unsubscribes while a subscription
            // is in pendingSubscriptions (i.e. after reconnect but before the server assigns a
            // new ID), the pending entry is not removed and may be replayed on the next reconnect.
            if (subId !== undefined) activeSubscriptions.delete(subId);
          }
        }

        conn.send(message);
      },

      disconnect() {
        pendingSubscriptions.clear();
        activeSubscriptions.clear();
        unsubReconnect();
        conn.disconnect();
      },
    };
  };
