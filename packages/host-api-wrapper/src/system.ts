import type { CodecType, Transport } from '@novasamatech/host-api';
import { HostInfo, ProductContext, createHostApi, enumValue } from '@novasamatech/host-api';

import { resultToPromise, unwrapVersionedResult } from './helpers.js';
import { sandboxTransport } from './sandboxTransport.js';

export type HostInfo = CodecType<typeof HostInfo>;
export type ProductContext = CodecType<typeof ProductContext>;

export const createSystem = (transport: Transport = sandboxTransport) => {
  const supportedVersion = 'v1';
  const hostApi = createHostApi(transport);

  return {
    // Identity and version of the host currently running the product.
    async info(): Promise<HostInfo> {
      return resultToPromise(
        unwrapVersionedResult(supportedVersion, hostApi.info(enumValue(supportedVersion, undefined))),
      );
    },
    // Product context bound to the current host runtime.
    async getProductContext(): Promise<ProductContext> {
      return resultToPromise(
        unwrapVersionedResult(supportedVersion, hostApi.getProductContext(enumValue(supportedVersion, undefined))),
      );
    },
  };
};

export const hostSystem = createSystem();
