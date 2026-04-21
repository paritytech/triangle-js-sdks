import { isResponse } from '@polkadot-api/json-rpc-provider';
import type { JsonRpcProvider } from 'polkadot-api';

type JsonRpcMessage = Parameters<Parameters<JsonRpcProvider>[0]>[0];
type JsonRpcRequest = Extract<JsonRpcMessage, { method: string }>;

const isChainMethod = (method: string): boolean => method.startsWith('chain_');

const isSubscribeMethod = (method: string): boolean => {
  if (isChainMethod(method)) return false;
  const m = method.toLowerCase();
  return m.includes('subscribe') && !m.includes('unsubscribe');
};

const isUnsubscribeMethod = (method: string): boolean =>
  !isChainMethod(method) && method.toLowerCase().includes('unsubscribe');

export const withSubscriptionReplay =
  (provider: JsonRpcProvider, onReconnect: (callback: VoidFunction) => VoidFunction): JsonRpcProvider =>
  onMessage => {
    // request id → request object (sent, awaiting server subscription ID)
    const pendingSubscriptions = new Map<number | string, JsonRpcRequest>();
    // server subscription ID → request object (confirmed by server)
    const activeSubscriptions = new Map<string, { id: number | string; payload: JsonRpcRequest }>();

    const conn = provider(message => {
      // Response with a string result means it's a subscription confirmation
      if (message.id && isResponse(message) && 'result' in message && typeof message.result === 'string') {
        const id = message.id as number | string;
        const pending = pendingSubscriptions.get(id);
        if (pending !== undefined) {
          pendingSubscriptions.delete(id);
          activeSubscriptions.set((message as { result: string }).result, { id, payload: pending });
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
        const { method, id, params } = message as { method?: string; id?: number | string; params?: unknown[] };

        if (method) {
          if (isSubscribeMethod(method)) {
            if (id !== undefined) pendingSubscriptions.set(id, message as JsonRpcRequest);
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

        conn.send(message as JsonRpcRequest);
      },

      disconnect() {
        pendingSubscriptions.clear();
        activeSubscriptions.clear();
        unsubReconnect();
        conn.disconnect();
      },
    };
  };
