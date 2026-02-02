import type { Provider } from '@novasamatech/host-api';
import { createDefaultLogger, createTransport } from '@novasamatech/host-api';

declare global {
  interface Window {
    __HOST_API_PORT__?: MessagePort;
    __HOST_WEBVIEW_MARK__?: boolean;
  }
}

function delay(ttl: number) {
  return new Promise<void>(resolve => setTimeout(resolve, ttl));
}

function getParentWindow() {
  if (window.top) {
    return window.top;
  }
  throw new Error('No parent window found');
}

function isIframe() {
  try {
    return window !== window.top;
  } catch {
    return false;
  }
}

function isWebview() {
  try {
    return window['__HOST_WEBVIEW_MARK__'] === true;
  } catch {
    return false;
  }
}

async function* pollWebviewPort(cooldown: number) {
  while (true) {
    yield window['__HOST_API_PORT__'];
    await delay(cooldown);
  }
}

async function getWebviewPort() {
  for await (const port of pollWebviewPort(100)) {
    if (port) {
      return port;
    }
  }
  throw new Error('No webview port found');
}

function isValidMessage(event: MessageEvent, sourceEnv: MessageEventSource, currentEnv: MessageEventSource) {
  return (
    event.source !== currentEnv &&
    event.source === sourceEnv &&
    event.data &&
    event.data.constructor.name === 'Uint8Array'
  );
}

function createDefaultSdkProvider(): Provider {
  const subscribers = new Set<(message: Uint8Array) => void>();

  const handleMessage = async (event: MessageEvent) => {
    const source = isIframe() ? getParentWindow() : isWebview() ? await getWebviewPort() : null;
    if (!source) throw new Error('No message source found');
    if (!isValidMessage(event, source, window)) return;

    for (const subscriber of subscribers) {
      subscriber(event.data);
    }
  };

  if (isIframe()) {
    window.addEventListener('message', handleMessage);
  } else if (isWebview()) {
    getWebviewPort().then(port => port.addEventListener('message', handleMessage));
  }

  return {
    logger: createDefaultLogger(),
    isCorrectEnvironment() {
      return isIframe() || isWebview();
    },
    postMessage(message) {
      if (isIframe()) {
        getParentWindow().postMessage(message, '*', [message.buffer]);
      } else if (isWebview()) {
        getWebviewPort().then(port => port.postMessage(message, [message.buffer]));
      }
    },
    subscribe(callback) {
      subscribers.add(callback);
      return () => {
        subscribers.delete(callback);
      };
    },
    dispose() {
      subscribers.clear();
      if (isIframe()) {
        window.removeEventListener('message', handleMessage);
      }
      if (isWebview()) {
        getWebviewPort().then(port => port.removeEventListener('message', handleMessage));
      }
    },
  };
}

export const sandboxProvider = createDefaultSdkProvider();
export const sandboxTransport = createTransport(sandboxProvider);
