import { PreimageSubmitErr, createTransport } from '@novasamatech/host-api';
import { createPreimageManager } from '@novasamatech/host-api-wrapper';
import type { ContainerHandlerOf } from '@novasamatech/host-container';
import { createContainer } from '@novasamatech/host-container';

import { describe, expect, it, vi } from 'vitest';

import { createHostApiProviders } from './__mocks__/hostApiProviders.js';

function setup() {
  const providers = createHostApiProviders();
  const container = createContainer(providers.host);
  const sdkTransport = createTransport(providers.sdk);
  const preimageManager = createPreimageManager(sdkTransport);

  return { container, preimageManager };
}

describe('Host API: Preimage', () => {
  it('should submit a preimage and gate on PreimageSubmit permission', async () => {
    const { container, preimageManager } = setup();
    const preimageData = new Uint8Array([1, 2, 3, 4]);
    const expectedKey = '0xdeadbeef';

    const permissionHandler = vi.fn<ContainerHandlerOf<typeof container.handlePermission>>((_params, { ok }) =>
      ok(true),
    );
    container.handlePermission(permissionHandler);
    const handler = vi.fn<ContainerHandlerOf<typeof container.handlePreimageSubmit>>((_, { ok }) => ok(expectedKey));
    container.handlePreimageSubmit(handler);

    await preimageManager.submit(preimageData);

    expect(handler).toBeCalledWith(preimageData, { ok: expect.any(Function), err: expect.any(Function) });
    expect(permissionHandler).toHaveBeenCalledOnce();
    const [receivedParams] = permissionHandler.mock.calls[0]!;
    expect(receivedParams).toEqual({ tag: 'PreimageSubmit', value: undefined });
  });

  it('should handle submit error and still gate on PreimageSubmit permission', async () => {
    const { container, preimageManager } = setup();
    const preimageData = new Uint8Array([5, 6, 7, 8]);
    const error = new PreimageSubmitErr.Unknown({ reason: 'Submit failed' });

    const permissionHandler = vi.fn<ContainerHandlerOf<typeof container.handlePermission>>((_params, { ok }) =>
      ok(true),
    );
    container.handlePermission(permissionHandler);
    container.handlePreimageSubmit((_, { err }) => err(error));

    await expect(preimageManager.submit(preimageData)).rejects.toEqual(error);

    expect(permissionHandler).toHaveBeenCalledOnce();
    const [receivedParams] = permissionHandler.mock.calls[0]!;
    expect(receivedParams).toEqual({ tag: 'PreimageSubmit', value: undefined });
  });
});
