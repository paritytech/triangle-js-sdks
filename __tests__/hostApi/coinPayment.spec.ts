import { CoinPaymentErr, createHostApi, createTransport, enumValue, hostApiProtocol } from '@novasamatech/host-api';
import type { ContainerHandlerOf } from '@novasamatech/host-container';
import { createContainer } from '@novasamatech/host-container';

import { describe, expect, it, vi } from 'vitest';

import { delay } from './__mocks__/helpers.js';
import { createHostApiProviders } from './__mocks__/hostApiProviders.js';

// eslint-disable-next-line @typescript-eslint/no-empty-function
function noop() {}

function setup() {
  const providers = createHostApiProviders();
  const container = createContainer(providers.host);
  const hostApi = createHostApi(createTransport(providers.sdk));

  return { container, hostApi };
}

describe('Host API: CoinPayment', () => {
  describe('wire indices', () => {
    it('pins every method to the truapi spec id', () => {
      // truapi RFC 0017 assigns ids 136-163. They are allocated positionally in
      // `hostApiProtocol`, so a table reorder would silently move them and break
      // compatibility with non-JS hosts.
      expect(hostApiProtocol.host_coin_payment_create_purse.index).toBe(136);
      expect(hostApiProtocol.host_coin_payment_query_purse.index).toBe(138);
      expect(hostApiProtocol.host_coin_payment_rebalance_purse.index).toBe(140);
      expect(hostApiProtocol.host_coin_payment_delete_purse.index).toBe(144);
      expect(hostApiProtocol.host_coin_payment_create_receivable.index).toBe(148);
      expect(hostApiProtocol.host_coin_payment_create_cheque.index).toBe(150);
      expect(hostApiProtocol.host_coin_payment_deposit.index).toBe(152);
      expect(hostApiProtocol.host_coin_payment_refund.index).toBe(156);
      expect(hostApiProtocol.host_coin_payment_listen_for_payment.index).toBe(160);
    });
  });

  describe('createPurse', () => {
    it('sends the name and resolves with the assigned purse id', async () => {
      const { container, hostApi } = setup();

      const handler = vi.fn<ContainerHandlerOf<typeof container.handleCoinPaymentCreatePurse>>((_, { ok }) =>
        ok({ purse: 5 }),
      );
      container.handleCoinPaymentCreatePurse(handler);

      const result = await hostApi.coinPaymentCreatePurse(enumValue('v1', { name: 'Terminal purse' }));

      expect(handler).toHaveBeenCalledWith({ name: 'Terminal purse' }, expect.anything());
      expect(result._unsafeUnwrap()).toEqual({ tag: 'v1', value: { purse: 5 } });
    });

    it('rejects with the host error', async () => {
      const { container, hostApi } = setup();

      container.handleCoinPaymentCreatePurse((_, { err }) => err(new CoinPaymentErr.Denied()));

      const result = await hostApi.coinPaymentCreatePurse(enumValue('v1', { name: 'x' }));

      expect(result._unsafeUnwrapErr().value).toEqual(new CoinPaymentErr.Denied());
    });
  });

  describe('rebalancePurse', () => {
    it('streams clearing status updates', async () => {
      const { container, hostApi } = setup();
      const reference = { root: `0x${'11'.repeat(32)}`, leaves: [] };

      container.handleCoinPaymentRebalancePurse((_start, send) => {
        send({ tag: 'Clearing', value: { clearing: 400, cleared: 400 } });
        send({ tag: 'Done', value: { cleared: 1000, reference } });
        return noop;
      });

      const received: unknown[] = [];
      hostApi.coinPaymentRebalancePurse(enumValue('v1', { from: 1, to: 2, amount: 1000 }), item =>
        received.push(item.value),
      );

      await delay(50);

      expect(received).toEqual([
        { tag: 'Clearing', value: { clearing: 400, cleared: 400 } },
        { tag: 'Done', value: { cleared: 1000, reference } },
      ]);
    });
  });
});
