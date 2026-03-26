import type { Provider } from '@novasamatech/host-api';
import { createDefaultLogger } from '@novasamatech/host-api';

import { createNanoEvents } from 'nanoevents';

export function createHostApiProviders() {
  type Events = 'toHost' | 'toSdk';
  const bus = createNanoEvents<Record<Events, (v: Uint8Array) => void>>();

  function createProvider(prefix: string, listenTo: Events, postTo: Events): Provider {
    return {
      logger: createDefaultLogger(prefix),
      isCorrectEnvironment: () => true,
      dispose: () => delete bus.events[listenTo],
      subscribe: callback => bus.on(listenTo, callback),
      postMessage: message => bus.emit(postTo, message),
    };
  }

  return {
    host: createProvider('HOST', 'toHost', 'toSdk'),
    sdk: createProvider('PRODUCT', 'toSdk', 'toHost'),
  };
}
