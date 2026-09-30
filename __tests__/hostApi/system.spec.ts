import { GenericError, createTransport, hostApiProtocol } from '@novasamatech/host-api';
import { createSystem } from '@novasamatech/host-api-wrapper';
import type { ContainerHandlerOf } from '@novasamatech/host-container';
import { createContainer } from '@novasamatech/host-container';

import { describe, expect, it } from 'vitest';

import { createHostApiProviders } from './__mocks__/hostApiProviders.js';

function setup() {
  const providers = createHostApiProviders();
  const container = createContainer(providers.host);
  const system = createSystem(createTransport(providers.sdk));

  return { container, system };
}

describe('Host API: System', () => {
  it('pins truapi (trait, method) wire addresses', () => {
    expect(hostApiProtocol.system.id).toBe(1);
    expect(hostApiProtocol.system.methods.info.id).toBe(3);
    expect(hostApiProtocol.system.methods.getProductContext.id).toBe(4);
    expect(hostApiProtocol.locale.id).toBe(16);
    expect(hostApiProtocol.locale.methods.subscribe.id).toBe(0);
  });

  it('resolves host info', async () => {
    const { container, system } = setup();
    const info = { platform: 'Desktop', name: 'Polkadot Desktop', version: '1.2.3' } as const;

    container.system.handleInfo(((_, { ok }) => ok(info)) as ContainerHandlerOf<typeof container.system.handleInfo>);

    await expect(system.info()).resolves.toEqual(info);
  });

  it('resolves the product context', async () => {
    const { container, system } = setup();

    container.system.handleGetProductContext(((_, { ok }) => ok({ productId: 'app.example' })) as ContainerHandlerOf<
      typeof container.system.handleGetProductContext
    >);

    await expect(system.getProductContext()).resolves.toEqual({ productId: 'app.example' });
  });

  it('rejects with the host error', async () => {
    const { container, system } = setup();
    const error = new GenericError({ reason: 'nope' });

    container.system.handleInfo((_, { err }) => err(error));

    await expect(system.info()).rejects.toEqual(error);
  });
});
