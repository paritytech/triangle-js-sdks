import { createTransport } from '@novasamatech/host-api';
import type { HostApiDebugMessageEvent } from '@novasamatech/host-container';
import { createContainer, onHostApiDebugMessage } from '@novasamatech/host-container';
import { createAccountsProvider } from '@novasamatech/product-sdk';

import { describe, expect, it, vi } from 'vitest';

import { createHostApiProviders } from './__mocks__/hostApiProviders.js';

function setup(productId?: string) {
  const providers = createHostApiProviders();
  const container = createContainer(providers.host, productId !== undefined ? { productId } : {});
  const sdkTransport = createTransport(providers.sdk);
  const accountsProvider = createAccountsProvider(sdkTransport);
  return { container, providers, sdkTransport, accountsProvider };
}

describe('host-container debug hook', () => {
  it('tags container-level events with the productId from createContainer', async () => {
    const { container, accountsProvider } = setup('product.alpha');

    const events: HostApiDebugMessageEvent[] = [];
    container.onDebugMessage(event => events.push(event));

    // any flow that produces traffic — the default unhandled getUserId triggers a request/response
    await accountsProvider.getProductAccount('product.alpha', 0);

    expect(events.length).toBeGreaterThan(0);
    for (const event of events) {
      expect(event.productId).toBe('product.alpha');
    }
  });

  it('leaves productId undefined when none is supplied', async () => {
    const { container, accountsProvider } = setup();

    const events: HostApiDebugMessageEvent[] = [];
    container.onDebugMessage(event => events.push(event));

    await accountsProvider.getProductAccount('product.alpha', 0);

    expect(events.length).toBeGreaterThan(0);
    for (const event of events) {
      expect(event.productId).toBeUndefined();
    }
  });

  it('global onHostApiDebugMessage aggregates events across multiple containers tagged by productId', async () => {
    const a = setup('product.alpha');
    const b = setup('product.beta');

    const seen: HostApiDebugMessageEvent[] = [];
    const unsubscribe = onHostApiDebugMessage(event => seen.push(event));

    await a.accountsProvider.getProductAccount('product.alpha', 0);
    await b.accountsProvider.getProductAccount('product.beta', 0);

    const ids = new Set(seen.map(e => e.productId));
    expect(ids.has('product.alpha')).toBe(true);
    expect(ids.has('product.beta')).toBe(true);

    unsubscribe();
    a.container.dispose();
    b.container.dispose();
  });

  it('container-level and global hook observe the same events for one container', async () => {
    const { container, accountsProvider } = setup('product.alpha');

    const containerEvents: HostApiDebugMessageEvent[] = [];
    const globalEvents: HostApiDebugMessageEvent[] = [];

    container.onDebugMessage(event => containerEvents.push(event));
    const unsubscribeGlobal = onHostApiDebugMessage(event => {
      if (event.productId === 'product.alpha') globalEvents.push(event);
    });

    await accountsProvider.getProductAccount('product.alpha', 0);

    expect(containerEvents.length).toBe(globalEvents.length);
    expect(containerEvents.length).toBeGreaterThan(0);
    expect(containerEvents).toEqual(globalEvents);

    unsubscribeGlobal();
  });

  it('disposes the global-bus forwarder when the container is disposed', async () => {
    const { container, accountsProvider } = setup('product.gamma');

    const seen = vi.fn<(e: HostApiDebugMessageEvent) => void>();
    const unsubscribe = onHostApiDebugMessage(event => {
      if (event.productId === 'product.gamma') seen(event);
    });

    await accountsProvider.getProductAccount('product.gamma', 0);
    const beforeDispose = seen.mock.calls.length;
    expect(beforeDispose).toBeGreaterThan(0);

    container.dispose();
    seen.mockClear();

    // a fresh, separately tagged container should not surface as 'product.gamma'
    const fresh = setup('product.delta');
    await fresh.accountsProvider.getProductAccount('product.delta', 0);

    expect(seen).not.toHaveBeenCalled();

    unsubscribe();
    fresh.container.dispose();
  });

  it('container-level unsubscribe stops further events without affecting the global bus', async () => {
    const { container, accountsProvider } = setup('product.alpha');

    const containerListener = vi.fn<(e: HostApiDebugMessageEvent) => void>();
    const globalListener = vi.fn<(e: HostApiDebugMessageEvent) => void>();
    const unsubscribeContainer = container.onDebugMessage(containerListener);
    const unsubscribeGlobal = onHostApiDebugMessage(event => {
      if (event.productId === 'product.alpha') globalListener(event);
    });

    await accountsProvider.getProductAccount('product.alpha', 0);
    expect(containerListener).toHaveBeenCalled();
    expect(globalListener).toHaveBeenCalled();

    unsubscribeContainer();
    containerListener.mockClear();
    globalListener.mockClear();

    await accountsProvider.getProductAccount('product.alpha', 0);
    expect(containerListener).not.toHaveBeenCalled();
    expect(globalListener).toHaveBeenCalled();

    unsubscribeGlobal();
    container.dispose();
  });
});
