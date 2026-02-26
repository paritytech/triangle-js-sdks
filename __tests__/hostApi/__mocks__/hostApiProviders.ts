import type { Provider } from '@novasamatech/host-api';
import { createDefaultLogger } from '@novasamatech/host-api';

import { createNanoEvents } from 'nanoevents';

export function createHostApiProviders() {
  type Events = 'toHost' | 'toSdk';
  const bus = createNanoEvents<Record<Events, (v: Uint8Array) => void>>();

  function createProvider(listenTo: Events, postTo: Events): Provider {
    return {
      logger: createDefaultLogger(),
      isCorrectEnvironment: () => true,
      dispose: () => delete bus.events[listenTo],
      subscribe: callback => bus.on(listenTo, callback),
      postMessage: message => bus.emit(postTo, message),
    };
  }

  return {
    host: createProvider('toHost', 'toSdk'),
    sdk: createProvider('toSdk', 'toHost'),
  };
}
