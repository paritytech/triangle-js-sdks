import { createTransport } from '@novasamatech/host-api';
import type { HostApiDebugMessageEvent } from '@novasamatech/host-container';
import { createContainer, onHostApiDebugMessage } from '@novasamatech/host-container';
import { createLocalStorage } from '@novasamatech/product-sdk';

import { describe, expect, it, vi } from 'vitest';

import { createHostApiProviders } from './__mocks__/hostApiProviders.js';

describe('EXPERIMENTAL: host <-> product debug hook', () => {
  it('Container.onDebugMessage sees both directions as decoded payloads, tagged with productId', async () => {
    const providers = createHostApiProviders();
    const container = createContainer(providers.host, { productId: 'product.alpha' });
    const sdkTransport = createTransport(providers.sdk);
    const localStorage = createLocalStorage(sdkTransport);

    // Minimal real handler so the request completes.
    container.handleLocalStorageRead((_key, { ok }) => ok(new Uint8Array([1, 2, 3])));

    const events: HostApiDebugMessageEvent[] = [];
    const unsubscribe = container.onDebugMessage(event => events.push(event));

    await localStorage.readBytes('some-key');

    unsubscribe();

    expect(events.length).toBeGreaterThan(0);
    for (const event of events) {
      expect(event.productId).toBe('product.alpha');
      expect(typeof event.requestId).toBe('string');
      expect(event.payload).toEqual(expect.objectContaining({ tag: expect.any(String) }));
      expect(event.payload).not.toBeInstanceOf(Uint8Array);
    }

    // Request came in from the product, response went out from the container.
    const actions = events.map(e => ({ direction: e.direction, tag: e.payload.tag }));
    expect(actions).toEqual(
      expect.arrayContaining([
        { direction: 'incoming', tag: 'host_local_storage_read_request' },
        { direction: 'outgoing', tag: 'host_local_storage_read_response' },
      ]),
    );
  });

  it('onHostApiDebugMessage aggregates messages from all containers in the process, each tagged with its productId', async () => {
    const collected: HostApiDebugMessageEvent[] = [];
    const unsubscribe = onHostApiDebugMessage(event => collected.push(event));

    const alphaProviders = createHostApiProviders();
    const alphaContainer = createContainer(alphaProviders.host, { productId: 'product.alpha' });
    const alphaSdk = createTransport(alphaProviders.sdk);
    const alphaLocalStorage = createLocalStorage(alphaSdk);
    alphaContainer.handleLocalStorageRead((_k, { ok }) => ok(new Uint8Array([1])));

    const betaProviders = createHostApiProviders();
    const betaContainer = createContainer(betaProviders.host, { productId: 'product.beta' });
    const betaSdk = createTransport(betaProviders.sdk);
    const betaLocalStorage = createLocalStorage(betaSdk);
    betaContainer.handleLocalStorageRead((_k, { ok }) => ok(new Uint8Array([2])));

    await Promise.all([alphaLocalStorage.readBytes('k'), betaLocalStorage.readBytes('k')]);

    unsubscribe();

    const productIds = new Set(collected.map(e => e.productId));
    expect(productIds.has('product.alpha')).toBe(true);
    expect(productIds.has('product.beta')).toBe(true);

    const alphaIncoming = collected.filter(
      e =>
        e.productId === 'product.alpha' &&
        e.direction === 'incoming' &&
        e.payload.tag === 'host_local_storage_read_request',
    );
    const betaIncoming = collected.filter(
      e =>
        e.productId === 'product.beta' &&
        e.direction === 'incoming' &&
        e.payload.tag === 'host_local_storage_read_request',
    );
    expect(alphaIncoming.length).toBeGreaterThan(0);
    expect(betaIncoming.length).toBeGreaterThan(0);
  });

  it('omitting productId leaves it undefined on events', async () => {
    const providers = createHostApiProviders();
    const container = createContainer(providers.host);
    const sdkTransport = createTransport(providers.sdk);
    const localStorage = createLocalStorage(sdkTransport);

    container.handleLocalStorageRead((_k, { ok }) => ok(new Uint8Array([1])));

    const spy = vi.fn();
    const unsubscribe = container.onDebugMessage(spy);
    await localStorage.readBytes('k');
    unsubscribe();

    expect(spy).toHaveBeenCalled();
    for (const [event] of spy.mock.calls) {
      expect((event as HostApiDebugMessageEvent).productId).toBeUndefined();
    }
  });

  it('unsubscribe stops further notifications', async () => {
    const providers = createHostApiProviders();
    const container = createContainer(providers.host, { productId: 'product.gamma' });
    const sdkTransport = createTransport(providers.sdk);
    const localStorage = createLocalStorage(sdkTransport);

    container.handleLocalStorageRead((_k, { ok }) => ok(new Uint8Array([1])));

    const spy = vi.fn();
    const unsubscribe = container.onDebugMessage(spy);
    await localStorage.readBytes('k');
    const countAfterFirst = spy.mock.calls.length;
    expect(countAfterFirst).toBeGreaterThan(0);

    unsubscribe();
    await localStorage.readBytes('k');

    expect(spy.mock.calls.length).toBe(countAfterFirst);
  });
});
