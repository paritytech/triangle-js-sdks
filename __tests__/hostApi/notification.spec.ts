import { GenericError, PushNotificationError, createHostApi, createTransport, enumValue } from '@novasamatech/host-api';
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
  it('should deliver an immediate notification and return a NotificationId', async () => {
    const { container, hostApi } = setup();
    const payload = { text: 'Hello, world!', deeplink: 'https://example.com/deep', scheduledAt: undefined };

    const devicePermissionHandler = vi.fn<ContainerHandlerOf<typeof container.handleDevicePermission>>(
      (_params, { ok }) => ok(true),
    );
    container.handleDevicePermission(devicePermissionHandler);
    const handler = vi.fn<ContainerHandlerOf<typeof container.handlePushNotification>>((_, { ok }) => ok(42));
    container.handlePushNotification(handler);

    const result = await hostApi.pushNotification(enumValue('v1', payload));

    result.match(
      ok => {
        expect(ok.tag).toBe('v1');
        expect(ok.value).toBe(42);
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
    const payload = { text: 'Notification body', deeplink: undefined, scheduledAt: undefined };

    container.handleDevicePermission((_, { ok }) => ok(true));
    const handler = vi.fn<ContainerHandlerOf<typeof container.handlePushNotification>>((_, { ok }) => ok(1));
    container.handlePushNotification(handler);

    const result = await hostApi.pushNotification(enumValue('v1', payload));

    expect(result.isOk()).toBe(true);
    expect(handler).toBeCalledWith(payload, { ok: expect.any(Function), err: expect.any(Function) });
  });

  it('should deliver a scheduled notification carrying scheduledAt as a u64', async () => {
    const { container, hostApi } = setup();
    const scheduledAt = BigInt(Date.UTC(2027, 0, 1));
    const payload = { text: 'reminder', deeplink: undefined, scheduledAt };

    container.handleDevicePermission((_, { ok }) => ok(true));
    const handler = vi.fn<ContainerHandlerOf<typeof container.handlePushNotification>>((_, { ok }) => ok(7));
    container.handlePushNotification(handler);

    const result = await hostApi.pushNotification(enumValue('v1', payload));

    expect(result.isOk()).toBe(true);
    expect(handler).toBeCalledWith(payload, { ok: expect.any(Function), err: expect.any(Function) });
  });

  it('should propagate ScheduleLimitReached', async () => {
    const { container, hostApi } = setup();
    const payload = { text: 'full queue', deeplink: undefined, scheduledAt: BigInt(2_000_000_000_000) };
    const error = new PushNotificationError.ScheduleLimitReached();

    container.handleDevicePermission((_, { ok }) => ok(true));
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
  });

  it('should propagate Unknown { reason } round-trip', async () => {
    const { container, hostApi } = setup();
    const payload = { text: 'boom', deeplink: undefined, scheduledAt: undefined };
    const error = new PushNotificationError.Unknown({ reason: 'OS rejected' });

    container.handleDevicePermission((_, { ok }) => ok(true));
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
  });

  it('should reject and skip the handler when Notifications permission is denied', async () => {
    const { container, hostApi } = setup();
    const payload = { text: 'blocked', deeplink: undefined, scheduledAt: undefined };

    container.handleDevicePermission((_, { ok }) => ok(false));
    const handler = vi.fn<ContainerHandlerOf<typeof container.handlePushNotification>>((_, { ok }) => ok(1));
    container.handlePushNotification(handler);

    const result = await hostApi.pushNotification(enumValue('v1', payload));

    expect(result.isErr()).toBe(true);
    result.match(
      () => {
        throw new Error('Expected failure');
      },
      failure => {
        expect(failure.tag).toBe('v1');
        expect(failure.value).toBeInstanceOf(PushNotificationError);
      },
    );
    expect(handler).not.toHaveBeenCalled();
  });

  it('should reject and skip the handler when the device permission handler errors', async () => {
    const { container, hostApi } = setup();
    const payload = { text: 'blocked', deeplink: undefined, scheduledAt: undefined };

    container.handleDevicePermission((_, { err }) => err(new GenericError({ reason: 'permission lookup failed' })));
    const handler = vi.fn<ContainerHandlerOf<typeof container.handlePushNotification>>((_, { ok }) => ok(1));
    container.handlePushNotification(handler);

    const result = await hostApi.pushNotification(enumValue('v1', payload));

    expect(result.isErr()).toBe(true);
    expect(handler).not.toHaveBeenCalled();
  });
});

describe('Host API: PushNotificationCancel', () => {
  it('should cancel a pending notification by id', async () => {
    const { container, hostApi } = setup();

    container.handleDevicePermission((_, { ok }) => ok(true));
    const handler = vi.fn<ContainerHandlerOf<typeof container.handlePushNotificationCancel>>((_, { ok }) =>
      ok(undefined),
    );
    container.handlePushNotificationCancel(handler);

    const result = await hostApi.pushNotificationCancel(enumValue('v1', 42));

    expect(result.isOk()).toBe(true);
    expect(handler).toBeCalledWith(42, { ok: expect.any(Function), err: expect.any(Function) });
  });

  it('should propagate GenericError when the host returns one', async () => {
    const { container, hostApi } = setup();
    const error = new GenericError({ reason: 'cancel failed' });

    container.handleDevicePermission((_, { ok }) => ok(true));
    container.handlePushNotificationCancel((_, { err }) => err(error));

    const result = await hostApi.pushNotificationCancel(enumValue('v1', 1));

    result.match(
      () => {
        throw new Error('Expected failure');
      },
      failure => {
        expect(failure.tag).toBe('v1');
        expect(failure.value).toEqual(error);
      },
    );
  });

  it('should reject cancel when Notifications permission is denied', async () => {
    const { container, hostApi } = setup();

    container.handleDevicePermission((_, { ok }) => ok(false));
    const handler = vi.fn<ContainerHandlerOf<typeof container.handlePushNotificationCancel>>((_, { ok }) =>
      ok(undefined),
    );
    container.handlePushNotificationCancel(handler);

    const result = await hostApi.pushNotificationCancel(enumValue('v1', 5));

    expect(result.isErr()).toBe(true);
    expect(handler).not.toHaveBeenCalled();
  });
});
