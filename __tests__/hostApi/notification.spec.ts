import { GenericError, createHostApi, createTransport, enumValue } from '@novasamatech/host-api';
import type { ContainerHandlerOf } from '@novasamatech/host-container';
import { createContainer } from '@novasamatech/host-container';

import { describe, expect, it, vi } from 'vitest';

import { createHostApiProviders } from './__mocks__/hostApiProviders.js';

function setup() {
  const providers = createHostApiProviders();
  const container = createContainer(providers.host);
  const sdkTransport = createTransport(providers.sdk);
  const hostApi = createHostApi(sdkTransport);

  return { container, hostApi };
}

describe('Host API: PushNotification', () => {
  it('should deliver a notification and gate on Notifications device permission', async () => {
    const { container, hostApi } = setup();
    const payload = { text: 'Hello, world!', deeplink: 'https://example.com/deep' };

    const devicePermissionHandler = vi.fn<ContainerHandlerOf<typeof container.handleDevicePermission>>(
      (_params, { ok }) => ok(true),
    );
    container.handleDevicePermission(devicePermissionHandler);
    const handler = vi.fn<ContainerHandlerOf<typeof container.handlePushNotification>>((_, { ok }) => ok(undefined));
    container.handlePushNotification(handler);

    const result = await hostApi.pushNotification(enumValue('v1', payload));

    result.match(
      ok => {
        expect(ok.tag).toBe('v1');
        expect(ok.value).toBeUndefined();
      },
      () => {
        throw new Error('Expected success');
      },
    );

    expect(handler).toBeCalledWith(payload, { ok: expect.any(Function), err: expect.any(Function) });
    expect(devicePermissionHandler).toHaveBeenCalledOnce();
    const [receivedPermissionParams] = devicePermissionHandler.mock.calls[0]!;
    expect(receivedPermissionParams).toBe('Notifications');
  });

  it('should deliver a notification without a deeplink', async () => {
    const { container, hostApi } = setup();
    const payload = { text: 'Notification body', deeplink: undefined };

    container.handleDevicePermission((_, { ok }) => ok(true));
    const handler = vi.fn<ContainerHandlerOf<typeof container.handlePushNotification>>((_, { ok }) => ok(undefined));
    container.handlePushNotification(handler);

    const result = await hostApi.pushNotification(enumValue('v1', payload));

    expect(result.isOk()).toBe(true);
    expect(handler).toBeCalledWith(payload, { ok: expect.any(Function), err: expect.any(Function) });
  });

  it('should propagate handler errors and still gate on Notifications permission', async () => {
    const { container, hostApi } = setup();
    const payload = { text: 'will fail', deeplink: undefined };
    const error = new GenericError({ reason: 'Delivery failed' });

    const devicePermissionHandler = vi.fn<ContainerHandlerOf<typeof container.handleDevicePermission>>(
      (_params, { ok }) => ok(true),
    );
    container.handleDevicePermission(devicePermissionHandler);
    container.handlePushNotification((_, { err }) => err(error));

    const result = await hostApi.pushNotification(enumValue('v1', payload));

    result.match(
      () => {
        throw new Error('Expected failure');
      },
      failure => {
        expect(failure.tag).toBe('v1');
        expect(failure.value).toEqual(error);
      },
    );

    expect(devicePermissionHandler).toHaveBeenCalledOnce();
    const [receivedPermissionParams] = devicePermissionHandler.mock.calls[0]!;
    expect(receivedPermissionParams).toBe('Notifications');
  });

  it('should reject and skip the handler when Notifications permission is denied', async () => {
    const { container, hostApi } = setup();
    const payload = { text: 'blocked', deeplink: undefined };

    container.handleDevicePermission((_, { ok }) => ok(false));
    const handler = vi.fn<ContainerHandlerOf<typeof container.handlePushNotification>>((_, { ok }) => ok(undefined));
    container.handlePushNotification(handler);

    const result = await hostApi.pushNotification(enumValue('v1', payload));

    expect(result.isErr()).toBe(true);
    result.match(
      () => {
        throw new Error('Expected failure');
      },
      failure => {
        expect(failure.tag).toBe('v1');
        expect(failure.value).toBeInstanceOf(GenericError);
      },
    );
    expect(handler).not.toHaveBeenCalled();
  });

  it('should reject and skip the handler when the device permission handler errors', async () => {
    const { container, hostApi } = setup();
    const payload = { text: 'blocked', deeplink: undefined };

    container.handleDevicePermission((_, { err }) => err(new GenericError({ reason: 'permission lookup failed' })));
    const handler = vi.fn<ContainerHandlerOf<typeof container.handlePushNotification>>((_, { ok }) => ok(undefined));
    container.handlePushNotification(handler);

    const result = await hostApi.pushNotification(enumValue('v1', payload));

    expect(result.isErr()).toBe(true);
    expect(handler).not.toHaveBeenCalled();
  });
});
