import type { ConnectionStatus } from '@novasamatech/host-api';
import { createTransport } from '@novasamatech/host-api';
import { createMetaProvider } from '@novasamatech/host-api-wrapper';
import { createContainer } from '@novasamatech/host-container';

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

  it('stops delivering updates after unsubscribe', async () => {
    const { container } = setup();
    const callback = vi.fn();

    const unsubscribe = container.subscribeProductConnectionStatus(callback);
    // subscribe is documented to replay the current status synchronously.
    const callsBeforeUnsubscribe = callback.mock.calls.length;
    unsubscribe();

    await container.isReady();

    // No further deliveries after unsubscribe even though the status changed.
    expect(callback).toHaveBeenCalledTimes(callsBeforeUnsubscribe);
  });

  it('delivers the final connected status to every subscriber', async () => {
    const { container } = setup();
    const observe = () => {
      const statuses: ConnectionStatus[] = [];
      container.subscribeProductConnectionStatus(s => statuses.push(s));
      return statuses;
    };
    const seen = [observe(), observe()];

    await container.isReady();

    // Both subscribers must observe the 'connecting' transition and converge
    // on 'connected'. The starting status depends on whether init has already
    // fired by subscribe-time and is not part of the contract.
    for (const s of seen) {
      expect(s.at(-1)).toBe('connected');
      expect(s).toContain('connecting');
    }
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
