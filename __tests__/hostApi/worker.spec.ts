import { WorkerErr, createTransport } from '@novasamatech/host-api';
import { createWorker } from '@novasamatech/host-api-wrapper';
import type { ContainerHandlerOf } from '@novasamatech/host-container';
import { createContainer } from '@novasamatech/host-container';

import { describe, expect, it, vi } from 'vitest';

import { createHostApiProviders } from './__mocks__/hostApiProviders.js';

function setup() {
  const providers = createHostApiProviders();
  const container = createContainer(providers.host);
  const sdkTransport = createTransport(providers.sdk);
  const worker = createWorker(sdkTransport);

  return { container, worker };
}

describe('Host API: Worker', () => {
  describe('beginOperation', () => {
    it('sends the label and resolves with the host-assigned id', async () => {
      const { container, worker } = setup();

      const handler = vi.fn<ContainerHandlerOf<typeof container.worker.handleBeginOperation>>((_, { ok }) =>
        ok({ id: 7 }),
      );
      container.worker.handleBeginOperation(handler);

      const id = await worker.beginOperation('funding');

      expect(handler).toHaveBeenCalledWith(
        { label: 'funding' },
        { ok: expect.any(Function), err: expect.any(Function), signal: expect.any(AbortSignal) },
      );
      expect(id).toBe(7);
    });

    it('rejects with the host error', async () => {
      const { container, worker } = setup();
      const error = new WorkerErr.TooManyOpen();

      container.worker.handleBeginOperation((_, { err }) => err(error));

      await expect(worker.beginOperation()).rejects.toEqual(error);
    });
  });

  describe('endOperation', () => {
    it('sends the operation id', async () => {
      const { container, worker } = setup();

      const handler = vi.fn<ContainerHandlerOf<typeof container.worker.handleEndOperation>>((_, { ok }) =>
        ok(undefined),
      );
      container.worker.handleEndOperation(handler);

      await worker.endOperation(7);

      expect(handler).toHaveBeenCalledWith(
        { id: 7 },
        { ok: expect.any(Function), err: expect.any(Function), signal: expect.any(AbortSignal) },
      );
    });
  });
});
