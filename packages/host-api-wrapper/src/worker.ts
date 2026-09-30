import type { Transport } from '@novasamatech/host-api';
import { createHostApi, enumValue } from '@novasamatech/host-api';

import { resultToPromise, unwrapVersionedResult } from './helpers.js';
import { sandboxTransport } from './sandboxTransport.js';

export const createWorker = (transport: Transport = sandboxTransport) => {
  const supportedVersion = 'v1';
  const hostApi = createHostApi(transport);

  return {
    // Begin a pending operation. The host keeps this worker alive while it has
    // at least one open operation, so a background task runs to completion even
    // after the product's surface goes away. Returns the operation id.
    async beginOperation(label?: string): Promise<number> {
      const { id } = await resultToPromise(
        unwrapVersionedResult(supportedVersion, hostApi.worker.beginOperation(enumValue(supportedVersion, { label }))),
      );
      return id;
    },
    // End a pending operation. Idempotent: an unknown or already-ended id
    // still resolves.
    async endOperation(id: number): Promise<void> {
      return resultToPromise(
        unwrapVersionedResult(supportedVersion, hostApi.worker.endOperation(enumValue(supportedVersion, { id }))),
      );
    },
  };
};

export const hostWorker = createWorker();
