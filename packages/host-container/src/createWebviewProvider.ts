import type { Logger, Provider } from '@novasamatech/host-api';
import { createDefaultLogger } from '@novasamatech/host-api';
import type { WebviewTag } from 'electron';
import { nanoid } from 'nanoid';

import { WEBVIEW_HOST_PORT_NAME } from './constants.js';

function hasWindow() {
  try {
    return typeof window !== 'undefined';
  } catch {
    return false;
  }
}

function isValidMessage(event: MessageEvent) {
  return event.data && event.data.constructor.name === 'Uint8Array';
}

type Params = {
  webview: WebviewTag;
  logger?: Logger;
  openDevTools?: boolean;
};

export function createWebviewProvider({ webview, logger, openDevTools }: Params): Provider {
  let disposed = false;
  let port: MessagePort | null = null;
  const subscribers = new Set<(message: Uint8Array) => void>();

  const webviewPromise = new Promise<MessagePort>((resolve, reject) => {
    webview.addEventListener('did-fail-load', e => {
      reject(new Error(e.errorDescription));
    });

    webview.addEventListener('dom-ready', async () => {
      const { port1, port2 } = new MessageChannel();
      const portInitMessage = `HOST_API_PORT_INIT_${nanoid(12)}`;

      await webview
        .executeJavaScript(
          `
            window.addEventListener('message', e => {
              if (e.data === '${portInitMessage}') {
                const port = e.ports[0];
                if (port) {
                  window['${WEBVIEW_HOST_PORT_NAME}'] = port;
                }
              }
            });
         `,
        )
        .catch(reject);

      // @ts-expect-error contentWindow is undefined somehow
      webview.contentWindow.postMessage(portInitMessage, '*', [port2]);

      if (openDevTools) {
        webview.openDevTools();
      }

      port = port1;
      port.start();
      port.addEventListener('message', messageHandler);
      resolve(port);
    });
  });

  function waitForWebview(callback: (port: MessagePort) => void) {
    if (port) {
      return callback(port);
    }

    webviewPromise.then(callback);
  }

  const messageHandler = (event: MessageEvent) => {
    if (disposed) return;
    if (!isValidMessage(event)) return;

    for (const subscriber of subscribers) {
      subscriber(event.data);
    }
  };

  return {
    logger: logger ?? createDefaultLogger(),

    isCorrectEnvironment() {
      return hasWindow();
    },
    postMessage(message) {
      if (disposed) return;

      waitForWebview(port => {
        if (disposed) return;

        port.postMessage(message, [message.buffer]);
      });
    },
    subscribe(callback) {
      subscribers.add(callback);
      return () => {
        subscribers.delete(callback);
      };
    },
    dispose() {
      disposed = true;
      subscribers.clear();

      if (port) {
        port.removeEventListener('message', messageHandler);
      }
      port = null;
    },
  };
}
