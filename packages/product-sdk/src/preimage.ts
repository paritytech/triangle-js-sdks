import type { HexString, Subscription } from '@novasamatech/host-api';
import { createHostApi, enumValue } from '@novasamatech/host-api';

import { resultToPromise, unwrapVersionedResult } from './helpers.js';
import { sandboxTransport } from './sandboxTransport.js';

export const createPreimageManager = (transport = sandboxTransport) => {
  const supportedVersion = 'v1';
  const hostApi = createHostApi(transport);

  return {
    lookup(key: HexString, callback: (preimage: Uint8Array | null) => void): Subscription<void> {
      const subscriber = hostApi.preimageLookupSubscribe(enumValue(supportedVersion, key), payload => {
        if (payload.tag === supportedVersion) {
          callback(payload.value);
        }
      });

      return {
        unsubscribe: subscriber.unsubscribe,
        onInterrupt: cb => subscriber.onInterrupt(v => cb(v.value)),
      };
    },
    submit(value: Uint8Array) {
      return resultToPromise(
        unwrapVersionedResult(supportedVersion, hostApi.preimageSubmit(enumValue(supportedVersion, value))),
      );
    },
  };
};

export const preimageManager = createPreimageManager();
