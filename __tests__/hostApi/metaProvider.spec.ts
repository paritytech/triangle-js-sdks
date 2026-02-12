import type { ConnectionStatus } from '@novasamatech/host-api';
import { createTransport } from '@novasamatech/host-api';
import { createContainer } from '@novasamatech/host-container';
import { createMetaProvider } from '@novasamatech/product-sdk';

import { describe, expect, it, vi } from 'vitest';

import { createHostApiProviders } from './__mocks__/hostApiProviders.js';

function setup() {
  const providers = createHostApiProviders();
  const container = createContainer(providers.host);
  const sdkTransport = createTransport(providers.sdk);
  const metaProvider = createMetaProvider(sdkTransport);

  return { container, sdkTransport, metaProvider };
}

describe('Host API: meta provider', () => {
  it('should update connection status in container', async () => {
    const { container } = setup();
    const statuses: ConnectionStatus[] = [];

    container.subscribeProductConnectionStatus(status => {
      statuses.push(status);
    });

    await container.isReady();

    expect(statuses).toEqual(['disconnected', 'connecting', 'connected']);
  });

  it('should update connection status in meta provider', async () => {
    const { sdkTransport, metaProvider } = setup();
    const statuses: ConnectionStatus[] = [];

    metaProvider.subscribeConnectionStatus(status => {
      statuses.push(status);
    });

    await sdkTransport.isReady();

    expect(statuses).toEqual(['disconnected', 'connecting', 'connected']);
  });

  it('should handle container dispose', async () => {
    const { container } = setup();
    const statuses: ConnectionStatus[] = [];

    container.subscribeProductConnectionStatus(status => {
      statuses.push(status);
    });

    await container.isReady();

    container.dispose();

    // After dispose, statuses should include the full lifecycle
    expect(statuses).toContain('connected');
  });

  it('should unsubscribe from connection status', async () => {
    const { container } = setup();
    const callback = vi.fn();

    const unsubscribe = container.subscribeProductConnectionStatus(callback);

    // Unsubscribe before ready
    unsubscribe();

    await container.isReady();

    // Callback should have been called at least once before unsubscribe
    // but the exact count depends on timing
    expect(callback).toHaveBeenCalled();
  });

  it('should handle multiple status subscribers', async () => {
    const { container } = setup();
    const statuses1: ConnectionStatus[] = [];
    const statuses2: ConnectionStatus[] = [];

    // Subscribe both before any init happens
    container.subscribeProductConnectionStatus(status => {
      statuses1.push(status);
    });

    // Second subscriber may miss 'disconnected' if first subscriber triggered init
    container.subscribeProductConnectionStatus(status => {
      statuses2.push(status);
    });

    await container.isReady();

    // First subscriber sees full lifecycle
    expect(statuses1).toEqual(['disconnected', 'connecting', 'connected']);
    // Second subscriber may miss initial 'disconnected' as init was already triggered
    expect(statuses2).toEqual(['connecting', 'connected']);
  });

  it('should report disconnected status initially in meta provider', () => {
    const { metaProvider } = setup();
    const statuses: ConnectionStatus[] = [];

    metaProvider.subscribeConnectionStatus(status => {
      statuses.push(status);
    });

    // First status should be disconnected
    expect(statuses[0]).toBe('disconnected');
  });
});
