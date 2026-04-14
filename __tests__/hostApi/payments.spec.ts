import { PaymentRequestErr, PaymentTopUpErr, createTransport } from '@novasamatech/host-api';
import { createContainer } from '@novasamatech/host-container';
import type { PaymentBalance, PaymentStatus } from '@novasamatech/product-sdk';
import { createPaymentManager } from '@novasamatech/product-sdk';

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

    it('should interrupt when no handler is registered', async () => {
      const { payments } = setup();

      let interrupted = false;
      const sub = payments.subscribeBalance(noop);
      sub.onInterrupt(() => {
        interrupted = true;
      });

      await delay(50);
      expect(interrupted).toBe(true);
    });
  });

  describe('topUp', () => {
    it('should resolve with ProductAccount source', async () => {
      const { container, payments } = setup();

      container.handlePaymentTopUp((_params, { ok }) => ok(undefined));

      await expect(
        payments.topUp(100n, { type: 'productAccount', dotNsIdentifier: 'product.dot', derivationIndex: 0 }),
      ).resolves.toBeUndefined();
    });

    it('should resolve with PrivateKey source', async () => {
      const { container, payments } = setup();
      const key = new Uint8Array(32).fill(1);

      container.handlePaymentTopUp((_params, { ok }) => ok(undefined));

      await expect(payments.topUp(50n, { type: 'privateKey', key })).resolves.toBeUndefined();
    });

    it('should pass amount and source to handler', async () => {
      const { container, payments } = setup();
      const handler = vi.fn((_params: unknown, { ok }: { ok: (v: undefined) => unknown }) => ok(undefined));
      container.handlePaymentTopUp(handler as never);

      await payments.topUp(200n, { type: 'productAccount', dotNsIdentifier: 'myproduct.dot', derivationIndex: 2 });

      expect(handler).toHaveBeenCalledWith(
        { amount: 200n, source: { tag: 'ProductAccount', value: ['myproduct.dot', 2] } },
        expect.anything(),
      );
    });

    it('should reject with InsufficientFunds', async () => {
      const { container, payments } = setup();

      container.handlePaymentTopUp((_params, { err }) => err(new PaymentTopUpErr.InsufficientFunds()));

      await expect(
        payments.topUp(999n, { type: 'productAccount', dotNsIdentifier: 'product.dot', derivationIndex: 0 }),
      ).rejects.toBeInstanceOf(PaymentTopUpErr.InsufficientFunds);
    });

    it('should reject with InvalidSource', async () => {
      const { container, payments } = setup();

      container.handlePaymentTopUp((_params, { err }) => err(new PaymentTopUpErr.InvalidSource()));

      await expect(
        payments.topUp(100n, { type: 'productAccount', dotNsIdentifier: 'product.dot', derivationIndex: 0 }),
      ).rejects.toBeInstanceOf(PaymentTopUpErr.InvalidSource);
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
      const handler = vi.fn((_params: unknown, { ok }: { ok: (v: { id: string }) => unknown }) => ok({ id: 'p-1' }));
      container.handlePaymentRequest(handler as never);

      await payments.requestPayment(300n, destination);

      expect(handler).toHaveBeenCalledWith({ amount: 300n, destination }, expect.anything());
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
      const handler = vi.fn((_id: unknown, _send: unknown, _interrupt: unknown) => noop);
      container.handlePaymentStatusSubscribe(handler as never);

      payments.subscribePaymentStatus('my-payment-id', noop);

      await delay(50);

      expect(handler).toHaveBeenCalledWith('my-payment-id', expect.anything(), expect.anything());
    });

    it('should interrupt when no handler is registered', async () => {
      const { payments } = setup();

      let interrupted = false;
      const sub = payments.subscribePaymentStatus('unknown-id', noop);
      sub.onInterrupt(() => {
        interrupted = true;
      });

      await delay(50);
      expect(interrupted).toBe(true);
    });
  });
});
