import { PaymentRequestErr, PaymentTopUpErr, PaymentTopUpStatusErr, createTransport } from '@novasamatech/host-api';
import type { PaymentBalance, PaymentStatus, TopUpStatus } from '@novasamatech/host-api-wrapper';
import { createPaymentManager } from '@novasamatech/host-api-wrapper';
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
  const sdkTransport = createTransport(providers.sdk);
  const payments = createPaymentManager(sdkTransport);
  return { container, payments };
}

describe('Host API: Payments', () => {
  describe('subscribeBalance', () => {
    it('should deliver balance updates to callback', async () => {
      const { container, payments } = setup();

      container.handlePaymentBalanceSubscribe((_params, send, _interrupt) => {
        send({ available: 100n });
        return noop;
      });

      const received: PaymentBalance[] = [];
      payments.subscribeBalance(b => received.push(b));

      await delay(50);

      expect(received).toEqual([{ available: 100n }]);
    });

    it('should pass the selected purse to handler', async () => {
      const { container, payments } = setup();
      const handler = vi.fn<ContainerHandlerOf<typeof container.handlePaymentBalanceSubscribe>>(() => noop);
      container.handlePaymentBalanceSubscribe(handler);

      payments.subscribeBalance(noop, 7);

      await delay(50);

      expect(handler).toHaveBeenCalledWith({ purse: 7 }, expect.anything(), expect.anything());
    });
  });

  describe('topUp', () => {
    const topUpId = new Uint8Array(32).fill(0xa1);

    it('should resolve with ProductAccount source', async () => {
      const { container, payments } = setup();

      container.handlePaymentTopUp((_params, { ok }) => ok(undefined));

      await expect(
        payments.topUp(100n, { type: 'productAccount', derivationIndex: 0 }, topUpId),
      ).resolves.toBeUndefined();
    });

    it('should resolve with PrivateKey source', async () => {
      const { container, payments } = setup();
      const key = new Uint8Array(64).fill(1);

      container.handlePaymentTopUp((_params, { ok }) => ok(undefined));

      await expect(payments.topUp(50n, { type: 'privateKey', key }, topUpId)).resolves.toBeUndefined();
    });

    it('should resolve with Coins source', async () => {
      const { container, payments } = setup();
      const keys = [new Uint8Array(64).fill(1), new Uint8Array(64).fill(2)];

      container.handlePaymentTopUp((_params, { ok }) => ok(undefined));

      await expect(payments.topUp(75n, { type: 'coins', keys }, topUpId)).resolves.toBeUndefined();
    });

    it('should pass coin keys to handler', async () => {
      const { container, payments } = setup();
      const keys = [new Uint8Array(64).fill(7), new Uint8Array(64).fill(9)];
      const handler = vi.fn<ContainerHandlerOf<typeof container.handlePaymentTopUp>>((_params, { ok }) =>
        ok(undefined),
      );
      container.handlePaymentTopUp(handler);

      await payments.topUp(75n, { type: 'coins', keys }, topUpId);

      expect(handler).toHaveBeenCalledWith(
        { amount: 75n, source: { tag: 'Coins', value: keys }, id: topUpId },
        expect.anything(),
      );
    });

    it('should pass amount, source and id to handler', async () => {
      const { container, payments } = setup();
      const handler = vi.fn<ContainerHandlerOf<typeof container.handlePaymentTopUp>>((_params, { ok }) =>
        ok(undefined),
      );
      container.handlePaymentTopUp(handler);

      await payments.topUp(200n, { type: 'productAccount', derivationIndex: 2 }, topUpId);

      expect(handler).toHaveBeenCalledWith(
        { amount: 200n, source: { tag: 'ProductAccount', value: { tag: 'Index', value: 2 } }, id: topUpId },
        expect.anything(),
      );
    });

    it('should pass a raw 32-byte derivation index through unchanged', async () => {
      const { container, payments } = setup();
      const rawIndex = new Uint8Array(32).fill(0xee);
      const handler = vi.fn<ContainerHandlerOf<typeof container.handlePaymentTopUp>>((_params, { ok }) =>
        ok(undefined),
      );
      container.handlePaymentTopUp(handler);

      await payments.topUp(200n, { type: 'productAccount', derivationIndex: rawIndex }, topUpId);

      expect(handler).toHaveBeenCalledWith(
        { amount: 200n, source: { tag: 'ProductAccount', value: { tag: 'Raw', value: rawIndex } }, id: topUpId },
        expect.anything(),
      );
    });

    it('should pass the selected purse (into) to handler', async () => {
      const { container, payments } = setup();
      const handler = vi.fn<ContainerHandlerOf<typeof container.handlePaymentTopUp>>((_params, { ok }) =>
        ok(undefined),
      );
      container.handlePaymentTopUp(handler);

      await payments.topUp(200n, { type: 'productAccount', derivationIndex: 2 }, topUpId, 5);

      expect(handler).toHaveBeenCalledWith(
        {
          into: 5,
          amount: 200n,
          source: { tag: 'ProductAccount', value: { tag: 'Index', value: 2 } },
          id: topUpId,
        },
        expect.anything(),
      );
    });

    it('should reject with InvalidSource', async () => {
      const { container, payments } = setup();

      container.handlePaymentTopUp((_params, { err }) => err(new PaymentTopUpErr.InvalidSource()));

      await expect(
        payments.topUp(100n, { type: 'productAccount', derivationIndex: 0 }, topUpId),
      ).rejects.toBeInstanceOf(PaymentTopUpErr.InvalidSource);
    });

    it('should reject with AlreadyExists when the id is already registered', async () => {
      const { container, payments } = setup();

      container.handlePaymentTopUp((_params, { err }) => err(new PaymentTopUpErr.AlreadyExists()));

      await expect(
        payments.topUp(100n, { type: 'productAccount', derivationIndex: 0 }, topUpId),
      ).rejects.toBeInstanceOf(PaymentTopUpErr.AlreadyExists);
    });

    it('should reject with SourceBusy when the source has a live top up', async () => {
      const { container, payments } = setup();

      container.handlePaymentTopUp((_params, { err }) => err(new PaymentTopUpErr.SourceBusy()));

      await expect(
        payments.topUp(100n, { type: 'productAccount', derivationIndex: 0 }, topUpId),
      ).rejects.toBeInstanceOf(PaymentTopUpErr.SourceBusy);
    });
  });

  describe('subscribeTopUpStatus', () => {
    it('should deliver the full claim progression', async () => {
      const { container, payments } = setup();

      container.handlePaymentTopUpStatusSubscribe((_id, send, _interrupt) => {
        send({ tag: 'Detecting', value: undefined });
        send({ tag: 'Claiming', value: undefined });
        send({ tag: 'Claimed', value: { finalized: false } });
        send({ tag: 'Claimed', value: { finalized: true } });
        return noop;
      });

      const statuses: TopUpStatus[] = [];
      payments.subscribeTopUpStatus(new Uint8Array(32).fill(0xa1), s => statuses.push(s));

      await delay(50);

      expect(statuses).toEqual([
        { type: 'detecting' },
        { type: 'claiming' },
        { type: 'claimed', finalized: false },
        { type: 'claimed', finalized: true },
      ]);
    });

    it('should deliver ClaimedPartially with the actual claimed amount', async () => {
      const { container, payments } = setup();

      container.handlePaymentTopUpStatusSubscribe((_id, send, _interrupt) => {
        send({ tag: 'ClaimedPartially', value: { actualClaimed: 40n } });
        return noop;
      });

      const statuses: TopUpStatus[] = [];
      payments.subscribeTopUpStatus(new Uint8Array(32).fill(0xa1), s => statuses.push(s));

      await delay(50);

      expect(statuses).toEqual([{ type: 'claimedPartially', actualClaimed: 40n }]);
    });

    it('should deliver NotClaimed', async () => {
      const { container, payments } = setup();

      container.handlePaymentTopUpStatusSubscribe((_id, send, _interrupt) => {
        send({ tag: 'NotClaimed', value: undefined });
        return noop;
      });

      const statuses: TopUpStatus[] = [];
      payments.subscribeTopUpStatus(new Uint8Array(32).fill(0xa1), s => statuses.push(s));

      await delay(50);

      expect(statuses).toEqual([{ type: 'notClaimed' }]);
    });

    it('should pass the top up id to handler', async () => {
      const { container, payments } = setup();
      const handler = vi.fn<ContainerHandlerOf<typeof container.handlePaymentTopUpStatusSubscribe>>(() => noop);
      container.handlePaymentTopUpStatusSubscribe(handler);

      const id = new Uint8Array(32).fill(0xb2);
      payments.subscribeTopUpStatus(id, noop);

      await delay(50);

      expect(handler).toHaveBeenCalledWith(id, expect.anything(), expect.anything());
    });

    it('should interrupt with NotFound for an unknown id', async () => {
      const { container, payments } = setup();

      container.handlePaymentTopUpStatusSubscribe((_id, _send, interrupt) => {
        // Deferred: an interrupt raised synchronously from the handler outruns
        // the product-side subscription bookkeeping and is dropped.
        setTimeout(() => interrupt(new PaymentTopUpStatusErr.NotFound()), 0);
        return noop;
      });

      const interrupted = vi.fn();
      payments.subscribeTopUpStatus(new Uint8Array(32).fill(0xff), noop).onInterrupt(interrupted);

      await delay(50);

      expect(interrupted).toHaveBeenCalledWith(expect.any(PaymentTopUpStatusErr.NotFound));
    });
  });

  describe('requestPayment', () => {
    const destination = new Uint8Array(32).fill(0xab);

    it('should return payment receipt on success', async () => {
      const { container, payments } = setup();

      container.handlePaymentRequest((_params, { ok }) => ok({ id: 'payment-123' }));

      const receipt = await payments.requestPayment(500n, destination);
      expect(receipt).toEqual({ id: 'payment-123' });
    });

    it('should pass amount and destination to handler', async () => {
      const { container, payments } = setup();
      const handler = vi.fn<ContainerHandlerOf<typeof container.handlePaymentRequest>>((_params, { ok }) =>
        ok({ id: 'p-1' }),
      );
      container.handlePaymentRequest(handler);

      await payments.requestPayment(300n, destination);

      expect(handler).toHaveBeenCalledWith({ amount: 300n, destination }, expect.anything());
    });

    it('should pass the selected purse (from) to handler', async () => {
      const { container, payments } = setup();
      const handler = vi.fn<ContainerHandlerOf<typeof container.handlePaymentRequest>>((_params, { ok }) =>
        ok({ id: 'p-1' }),
      );
      container.handlePaymentRequest(handler);

      await payments.requestPayment(300n, destination, 9);

      expect(handler).toHaveBeenCalledWith({ from: 9, amount: 300n, destination }, expect.anything());
    });

    it('should reject with Rejected', async () => {
      const { container, payments } = setup();

      container.handlePaymentRequest((_params, { err }) => err(new PaymentRequestErr.Rejected()));

      await expect(payments.requestPayment(100n, destination)).rejects.toBeInstanceOf(PaymentRequestErr.Rejected);
    });

    it('should reject with InsufficientBalance', async () => {
      const { container, payments } = setup();

      container.handlePaymentRequest((_params, { err }) => err(new PaymentRequestErr.InsufficientBalance()));

      await expect(payments.requestPayment(100n, destination)).rejects.toBeInstanceOf(
        PaymentRequestErr.InsufficientBalance,
      );
    });
  });

  describe('subscribePaymentStatus', () => {
    it('should deliver Processing then Completed', async () => {
      const { container, payments } = setup();

      container.handlePaymentStatusSubscribe((_paymentId, send, _interrupt) => {
        send({ tag: 'Processing', value: undefined });
        send({ tag: 'Completed', value: undefined });
        return noop;
      });

      const statuses: PaymentStatus[] = [];
      payments.subscribePaymentStatus('payment-123', s => statuses.push(s));

      await delay(50);

      expect(statuses).toEqual([{ type: 'processing' }, { type: 'completed' }]);
    });

    it('should deliver Failed status with reason', async () => {
      const { container, payments } = setup();

      container.handlePaymentStatusSubscribe((_paymentId, send, _interrupt) => {
        send({ tag: 'Failed', value: 'insufficient recycler vouchers' });
        return noop;
      });

      const statuses: PaymentStatus[] = [];
      payments.subscribePaymentStatus('payment-abc', s => statuses.push(s));

      await delay(50);

      expect(statuses).toEqual([{ type: 'failed', reason: 'insufficient recycler vouchers' }]);
    });

    it('should pass payment id to handler', async () => {
      const { container, payments } = setup();
      const handler = vi.fn<ContainerHandlerOf<typeof container.handlePaymentStatusSubscribe>>(() => noop);
      container.handlePaymentStatusSubscribe(handler);

      payments.subscribePaymentStatus('my-payment-id', noop);

      await delay(50);

      expect(handler).toHaveBeenCalledWith('my-payment-id', expect.anything(), expect.anything());
    });
  });
});
