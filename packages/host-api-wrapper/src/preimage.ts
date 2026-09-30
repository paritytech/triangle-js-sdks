import type { HexString, Subscription } from '@novasamatech/host-api';
import { createHostApi, enumValue } from '@novasamatech/host-api';

import type { GenericInterrupt } from './helpers.js';
import { genericInterrupt, resultToPromise, unwrapVersionedResult, unwrapVersionedSubscription } from './helpers.js';
import { sandboxTransport } from './sandboxTransport.js';

export const createPreimageManager = (transport = sandboxTransport) => {
  const supportedVersion = 'v1';
  const hostApi = createHostApi(transport);

  return {
    lookup(
      key: HexString,
      callback: (preimage: Uint8Array | null) => void,
    ): Subscription<GenericInterrupt | undefined> {
      return unwrapVersionedSubscription(
        hostApi.preimage.lookupSubscribe(enumValue(supportedVersion, key), payload => {
          if (payload.tag === supportedVersion) {
            callback(payload.value);
          }
        }),
        genericInterrupt,
      );
    },
    submit(value: Uint8Array) {
      return resultToPromise(
        unwrapVersionedResult(supportedVersion, hostApi.preimage.submit(enumValue(supportedVersion, value))),
      );
    },
  };
};

export const preimageManager = createPreimageManager();
