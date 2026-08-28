import { CoinPaymentErr, createTransport } from '@novasamatech/host-api';
import { createCoinPayment } from '@novasamatech/host-api-wrapper';
import type { ContainerHandlerOf } from '@novasamatech/host-container';
import { createContainer } from '@novasamatech/host-container';

import { describe, expect, it } from 'vitest';

import { delay } from './__mocks__/helpers.js';
import { createHostApiProviders } from './__mocks__/hostApiProviders.js';

// eslint-disable-next-line @typescript-eslint/no-empty-function
function noop() {}

function setup() {
  const providers = createHostApiProviders();
  const container = createContainer(providers.host);
  const coinPayment = createCoinPayment(createTransport(providers.sdk));

  return { container, coinPayment };
}

describe('Host API wrapper: CoinPayment', () => {
  it('createPurse resolves with the assigned id', async () => {
    const { container, coinPayment } = setup();

    const handler: ContainerHandlerOf<typeof container.handleCoinPaymentCreatePurse> = (name, { ok }) => {
      expect(name).toEqual({ name: 'Terminal purse' });
      return ok({ purse: 9 });
    };
    container.handleCoinPaymentCreatePurse(handler);

    await expect(coinPayment.createPurse('Terminal purse')).resolves.toBe(9);
  });

  it('createPurse rejects with the host error', async () => {
    const { container, coinPayment } = setup();
    container.handleCoinPaymentCreatePurse((_, { err }) => err(new CoinPaymentErr.Denied()));

    await expect(coinPayment.createPurse('x')).rejects.toEqual(new CoinPaymentErr.Denied());
  });

  it('rebalancePurse streams clearing status to the callback', async () => {
    const { container, coinPayment } = setup();
    const reference = { root: `0x${'11'.repeat(32)}`, leaves: [] };

    container.handleCoinPaymentRebalancePurse((start, send) => {
      expect(start).toEqual({ from: 1, to: 2, amount: 1000 });
      send({ tag: 'Done', value: { cleared: 1000, reference } });
      return noop;
    });

    const received: unknown[] = [];
    coinPayment.rebalancePurse(1, 2, 1000, status => received.push(status));

    await delay(50);

    expect(received).toEqual([{ tag: 'Done', value: { cleared: 1000, reference } }]);
  });
});
