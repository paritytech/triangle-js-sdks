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
  describe('wire ids', () => {
    it('pins every method to the truapi spec (trait, method) id', () => {
      // truapi `generated/wire_table.rs` puts coin payment at trait 5, methods
      // 0-8. Method ids are allocated explicitly in `hostApiProtocol`; a change
      // here would break compatibility with non-JS hosts.
      const { id, methods } = hostApiProtocol.coinPayment;
      expect(id).toBe(5);
      expect(methods.createPurse.id).toBe(0);
      expect(methods.queryPurse.id).toBe(1);
      expect(methods.rebalancePurse.id).toBe(2);
      expect(methods.deletePurse.id).toBe(3);
      expect(methods.createReceivable.id).toBe(4);
      expect(methods.createCheque.id).toBe(5);
      expect(methods.deposit.id).toBe(6);
      expect(methods.refund.id).toBe(7);
      expect(methods.listenForPayment.id).toBe(8);
    });
  });

  describe('createPurse', () => {
    it('sends the name and resolves with the assigned purse id', async () => {
      const { container, hostApi } = setup();

      const handler = vi.fn<ContainerHandlerOf<typeof container.coinPayment.handleCreatePurse>>((_, { ok }) =>
        ok({ purse: 5 }),
      );
      container.coinPayment.handleCreatePurse(handler);

      const result = await hostApi.coinPayment.createPurse(enumValue('v1', { name: 'Terminal purse' }));

      expect(handler).toHaveBeenCalledWith({ name: 'Terminal purse' }, expect.anything());
      expect(result._unsafeUnwrap()).toEqual({ tag: 'v1', value: { purse: 5 } });
    });

    it('rejects with the host error', async () => {
      const { container, hostApi } = setup();

      container.coinPayment.handleCreatePurse((_, { err }) => err(new CoinPaymentErr.Denied()));

      const result = await hostApi.coinPayment.createPurse(enumValue('v1', { name: 'x' }));

      expect(result._unsafeUnwrapErr().value).toEqual(new CoinPaymentErr.Denied());
    });
  });

  describe('rebalancePurse', () => {
    it('streams clearing status updates', async () => {
      const { container, hostApi } = setup();
      const reference = { root: `0x${'11'.repeat(32)}` as const, leaves: [] };

      container.coinPayment.handleRebalancePurse((_start, send) => {
        send({ tag: 'Clearing', value: { clearing: 400, cleared: 400 } });
        send({ tag: 'Done', value: { cleared: 1000, reference } });
        return noop;
      });

      const received: unknown[] = [];
      hostApi.coinPayment.rebalancePurse(enumValue('v1', { from: 1, to: 2, amount: 1000 }), item =>
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
