import { PushNotificationError, StorageErr, createTransport } from '@novasamatech/host-api';
import { createLocalStorage, createNotificationManager } from '@novasamatech/host-api-wrapper';
import { createContainer } from '@novasamatech/host-container';

import { describe, expect, it } from 'vitest';

import { createHostApiProviders } from './__mocks__/hostApiProviders.js';

function setup() {
  const providers = createHostApiProviders();
  const container = createContainer(providers.host);
  const sdkTransport = createTransport(providers.sdk);
  const localStorage = createLocalStorage(sdkTransport);
  const notifications = createNotificationManager(sdkTransport);
  return { container, localStorage, notifications };
}

// The wire error envelope is truapi's `CallError`: a domain error travels in
// `CallError.Domain`, transparently unwrapped back to the domain error here.
// A host-side failure (a thrown handler) travels as `CallError.HostFailure` and
// is folded into the method's own `Unknown` error, so products keep one error
// type.
describe('CallError envelope', () => {
  it('unwraps a domain error back to the domain error', async () => {
    const { container, localStorage } = setup();
    container.handleLocalStorageRead((_, { err }) => err(new StorageErr.Full()));

    await expect(localStorage.readBytes('k')).rejects.toEqual(new StorageErr.Full());
  });

  it('folds a thrown host handler into the method Unknown error', async () => {
    const { container, localStorage } = setup();
    container.handleLocalStorageRead(() => {
      throw new Error('handler boom');
    });

    const error = await localStorage.readBytes('k').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(StorageErr.Unknown);
    expect((error as InstanceType<typeof StorageErr.Unknown>).payload.reason).toContain('host failure');
  });

  it('answers Unsupported for a method with no registered handler', async () => {
    // No `container.handleLocalStorageRead(...)`, so the host does not
    // implement the method. The container replies `CallError.Unsupported`,
    // which the wrapper folds into the method Unknown error.
    const { localStorage } = setup();

    const error = await localStorage.readBytes('k').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(StorageErr.Unknown);
    expect((error as InstanceType<typeof StorageErr.Unknown>).payload.reason).toContain('unsupported');
  });

  it('answers Unsupported for an unregistered permission-gated method, before the permission gate', async () => {
    // `host_push_notification` is device-permission gated and has no registered
    // handler (and no permission handler either). The method being unimplemented
    // takes precedence: the container answers Unsupported rather than asking for
    // a grant and returning a denied domain error.
    const { notifications } = setup();

    const error = await notifications.push({ text: 'hi' }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PushNotificationError.Unknown);
    expect((error as InstanceType<typeof PushNotificationError.Unknown>).payload.reason).toContain('unsupported');
  });
});
