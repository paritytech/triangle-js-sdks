import type { SocketLoggerFn } from '@polkadot-api/ws-provider';
import { WsEvent, getWsProvider } from '@polkadot-api/ws-provider';
import type { JsonRpcProvider } from 'polkadot-api';

import { noop } from './helpers.js';
import { createPauseController } from './pauseController.js';
import { withSubscriptionReplay } from './subscriptionReplayProvider.js';
import type { ConnectionStatus } from './types.js';

export type PausableJsonRpcProvider = JsonRpcProvider & {
  pause(): void;
  resume(): void;
};

export const isPausable = (provider: JsonRpcProvider): provider is PausableJsonRpcProvider => {
  const maybe = provider as Partial<PausableJsonRpcProvider>;
  return typeof maybe.pause === 'function' && typeof maybe.resume === 'function';
};

const STATUS_BY_WS_EVENT: Record<WsEvent, ConnectionStatus> = {
  [WsEvent.CONNECTING]: 'connecting',
  [WsEvent.CONNECTED]: 'connected',
  [WsEvent.ERROR]: 'disconnected',
  [WsEvent.CLOSE]: 'disconnected',
};

export const createWsJsonRpcProvider = (options: {
  endpoints: string[];
  onStatusChanged?: (status: ConnectionStatus) => void;
  websocketClass?: typeof WebSocket;
  heartbeatTimeout?: number;
  logger?: SocketLoggerFn;
}): PausableJsonRpcProvider => {
  let notifyReconnect: VoidFunction = noop;
  const onReconnect = (cb: VoidFunction): VoidFunction => {
    notifyReconnect = cb;
    return () => {
      notifyReconnect = noop;
    };
  };

  const pauseController = createPauseController();

  const baseProvider: JsonRpcProvider = getWsProvider(options.endpoints, {
    logger: options.logger,
    heartbeatTimeout: options.heartbeatTimeout,
    middleware: inner => pauseController.middleware(inner),
    websocketClass: options.websocketClass,
    onStatusChanged: event => {
      const status = STATUS_BY_WS_EVENT[event.type];
      if (status === 'connected') {
        notifyReconnect();
      }
      options.onStatusChanged?.(status);
    },
  });

  const replayProvider = withSubscriptionReplay(baseProvider, onReconnect);

  return Object.assign(replayProvider, {
    pause: () => pauseController.pause(),
    resume: () => pauseController.resume(),
  });
};
