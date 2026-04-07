import { enumValue } from '@novasamatech/host-api';

import { hostApi } from './hostApi.js';

export function deriveEntropy(key: Uint8Array) {
  return hostApi
    .deriveEntropy(enumValue('v1', key))
    .map(r => r.value)
    .mapErr(e => e.value);
}
