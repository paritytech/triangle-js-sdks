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

async function getWebviewPort(iteration = 200) {
  if (iteration === 0) {
    throw new Error('No webview port found');
  }
  if (window['__HOST_API_PORT__']) {
    return window['__HOST_API_PORT__'];
  }

  await delay(100);
  return getWebviewPort(iteration - 1);
}

function isValidIframeMessage(event: MessageEvent, sourceEnv: MessageEventSource, currentEnv: MessageEventSource) {
  return (
    event.source !== currentEnv &&
    event.source === sourceEnv &&
    event.data &&
    event.data.constructor.name === 'Uint8Array'
  );
}

function isValidWebviewMessage(event: MessageEvent) {
  return event.data && event.data.constructor.name === 'Uint8Array';
}

// Copy into a tight-fitting ArrayBuffer. Required before handing the array across
// an Electron IPC / structured-clone boundary: structured clone serializes the full
// underlying ArrayBuffer.
function detach(view: Uint8Array): Uint8Array {
  const copy = new Uint8Array(view.byteLength);
  copy.set(view);
  return copy;
}

function createDefaultSdkProvider(): Provider {
  const subscribers = new Set<(message: Uint8Array) => void>();

  const handleIframeMessage = (event: MessageEvent) => {
    if (!isValidIframeMessage(event, getParentWindow(), window)) return;
    for (const subscriber of subscribers) {
      subscriber(event.data);
    }
  };

  const handleWebviewMessage = (event: MessageEvent) => {
    if (!isValidWebviewMessage(event)) return;
    const detached = detach(event.data);
    for (const subscriber of subscribers) {
      subscriber(detached);
    }
  };

  if (isIframe()) {
    window.addEventListener('message', handleIframeMessage);
  } else if (isWebview()) {
    getWebviewPort().then(port => (port.onmessage = handleWebviewMessage));
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
        const detached = detach(message);
        getWebviewPort().then(port => port.postMessage(detached, [detached.buffer]));
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
        window.removeEventListener('message', handleIframeMessage);
      }
      if (isWebview()) {
        getWebviewPort().then(port => (port.onmessage = null));
      }
    },
  };
}

export const sandboxProvider = createDefaultSdkProvider();
export const sandboxTransport = createTransport(sandboxProvider);
