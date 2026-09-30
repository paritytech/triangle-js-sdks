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

    const handler: ContainerHandlerOf<typeof container.coinPayment.handleCreatePurse> = (name, { ok }) => {
      expect(name).toEqual({ name: 'Terminal purse' });
      return ok({ purse: 9 });
    };
    container.coinPayment.handleCreatePurse(handler);

    await expect(coinPayment.createPurse('Terminal purse')).resolves.toBe(9);
  });

  it('createPurse rejects with the host error', async () => {
    const { container, coinPayment } = setup();
    container.coinPayment.handleCreatePurse((_, { err }) => err(new CoinPaymentErr.Denied()));

    await expect(coinPayment.createPurse('x')).rejects.toEqual(new CoinPaymentErr.Denied());
  });

  it('rebalancePurse streams clearing status to the callback', async () => {
    const { container, coinPayment } = setup();
    const reference = { root: `0x${'11'.repeat(32)}` as const, leaves: [] };

    container.coinPayment.handleRebalancePurse((start, send) => {
      expect(start).toEqual({ from: 1, to: 2, amount: 1000 });
      send({ tag: 'Done', value: { cleared: 1000, reference } });
      return noop;
    });

    const received: unknown[] = [];
    coinPayment.rebalancePurse(1, 2, 1000, status => received.push(status));

    await delay(50);

    expect(received).toEqual([{ tag: 'Done', value: { cleared: 1000, reference } }]);
  });

  describe('onInterrupt', () => {
    it('receives the host domain error', async () => {
      const { container, coinPayment } = setup();

      const cheque = { id: `0x${'22'.repeat(32)}` as const, amount: 500, encryptedSecrets: '0xabcd' as const };

      container.coinPayment.handleDeposit((start, _send, interrupt) => {
        expect(start).toEqual({ cheque });
        interrupt(new CoinPaymentErr.SnipedCoins());
        return noop;
      });

      const reasons: unknown[] = [];
      coinPayment.deposit(cheque, noop).onInterrupt(reason => reasons.push(reason));

      await delay(50);

      expect(reasons).toEqual([new CoinPaymentErr.SnipedCoins()]);
    });

    it('receives undefined when the host ends the stream cleanly', async () => {
      const { container, coinPayment } = setup();

      container.coinPayment.handleRebalancePurse((_start, send, interrupt) => {
        send({ tag: 'Clearing', value: { clearing: 10, cleared: 0 } });
        interrupt(undefined);
        return noop;
      });

      const received: unknown[] = [];
      const reasons: unknown[] = [];
      coinPayment.rebalancePurse(1, 2, 10, status => received.push(status)).onInterrupt(reason => reasons.push(reason));

      await delay(50);

      expect(received).toEqual([{ tag: 'Clearing', value: { clearing: 10, cleared: 0 } }]);
      expect(reasons).toEqual([undefined]);
    });

    it('receives CoinPaymentErr.Internal when the host serves no handler', async () => {
      const { coinPayment } = setup();

      const reasons: unknown[] = [];
      coinPayment.rebalancePurse(1, 2, 10, noop).onInterrupt(reason => reasons.push(reason));

      await delay(50);

      expect(reasons).toEqual([new CoinPaymentErr.Internal()]);
    });
  });
});
