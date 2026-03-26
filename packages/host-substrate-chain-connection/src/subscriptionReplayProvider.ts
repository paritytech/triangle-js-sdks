import type { JsonRpcProvider } from '@polkadot-api/json-rpc-provider';

export const withSubscriptionReplay =
  (provider: JsonRpcProvider, onReconnect: (callback: VoidFunction) => VoidFunction): JsonRpcProvider =>
  onMessage => {
    // request id → raw JSON message (sent, awaiting server subscription ID)
    const pendingSubscriptions = new Map<number | string, string>();
    // server subscription ID → raw JSON message (confirmed by server)
    const activeSubscriptions = new Map<string, { id: number | string; payload: string }>();

    const conn = provider(message => {
      const parsed = JSON.parse(message) as { id?: number | string; result?: unknown };

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
        const { method, id, params } = JSON.parse(message) as {
          method?: string;
          id?: number | string;
          params?: unknown[];
        };

        // TODO support chain follow and other events as well
        if (method) {
          const normalizedMethod = method.toLowerCase();

          if (normalizedMethod.includes('subscribe') && !normalizedMethod.includes('unsubscribe')) {
            if (id !== undefined) pendingSubscriptions.set(id, message);
          } else if (normalizedMethod.includes('unsubscribe')) {
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
