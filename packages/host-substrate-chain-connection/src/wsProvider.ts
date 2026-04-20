import type { JsonRpcProvider } from 'polkadot-api';
import { WsEvent, getWsProvider } from 'polkadot-api/ws';

import { noop } from './helpers.js';
import type { PausableJsonRpcProvider } from './pausableProvider.js';
import { createPausableProvider } from './pausableProvider.js';
import { withSubscriptionReplay } from './subscriptionReplayProvider.js';
import type { ConnectionStatus } from './types.js';

export const createWsJsonRpcProvider = (options: {
  endpoints: string[];
  onStatusChanged?: (status: ConnectionStatus) => void;
}): PausableJsonRpcProvider => {
  let notifyReconnect: VoidFunction = noop;
  const onReconnect = (cb: VoidFunction): VoidFunction => {
    notifyReconnect = cb;
    return () => {
      notifyReconnect = noop;
    };
  };

  const innerWs: JsonRpcProvider = getWsProvider(options.endpoints, {
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
  });

  const pausable = createPausableProvider(innerWs);
  const replayed = withSubscriptionReplay(pausable, onReconnect);

  return Object.assign(replayed, {
    pause: () => pausable.pause(),
    resume: () => pausable.resume(),
  });
};
