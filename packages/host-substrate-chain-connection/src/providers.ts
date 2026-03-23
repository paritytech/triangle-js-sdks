import type { JsonRpcProvider } from '@polkadot-api/json-rpc-provider';
import { withPolkadotSdkCompat } from 'polkadot-api/polkadot-sdk-compat';
import { WsEvent, getWsProvider } from 'polkadot-api/ws-provider';

import type { ConnectionStatus } from './types.js';

export const createWsJsonRpcProvider = (options: {
  endpoints: string[];
  onStatusChanged?: (status: ConnectionStatus) => void;
}): JsonRpcProvider => {
  return withPolkadotSdkCompat(
    getWsProvider(options.endpoints, {
      heartbeatTimeout: Number.POSITIVE_INFINITY,
      onStatusChanged: event => {
        let status: ConnectionStatus;

        switch (event.type) {
          case WsEvent.CONNECTING:
            status = 'connecting';
            break;
          case WsEvent.CONNECTED:
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
  );
};
