import type { JsonRpcProvider } from '@polkadot-api/json-rpc-provider';
import { WsEvent, getWsProvider } from '@polkadot-api/ws-provider';

import { noop } from './helpers.js';
import { withSubscriptionReplay } from './subscriptionReplayProvider.js';
import type { ConnectionStatus } from './types.js';

export const createWsJsonRpcProvider = (options: {
  endpoints: string[];
  onStatusChanged?: (status: ConnectionStatus) => void;
}): JsonRpcProvider => {
  let notifyReconnect: VoidFunction = noop;
  const onReconnect = (cb: VoidFunction): VoidFunction => {
    notifyReconnect = cb;
    return () => {
      notifyReconnect = noop;
    };
  };

  return withSubscriptionReplay(
    getWsProvider(options.endpoints, {
      heartbeatTimeout: Number.POSITIVE_INFINITY,
      onStatusChanged: event => {
        let status: ConnectionStatus;

        switch (event.type) {
          case WsEvent.CONNECTING:
            status = 'connecting';
            break;
          case WsEvent.CONNECTED:
            notifyReconnect();
            status = 'connected';
            break;
          case WsEvent.ERROR:
          case WsEvent.CLOSE:
            status = 'disconnected';
            break;
          default:
            status = 'disconnected';
            break;
        }

        options.onStatusChanged?.(status);
      },
    }),
    onReconnect,
  );
};
