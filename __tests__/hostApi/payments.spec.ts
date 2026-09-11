import {
  PaymentRequestErr,
  PaymentStatusErr,
  PaymentTopUpErr,
  PaymentTopUpStatusErr,
  createTransport,
} from '@novasamatech/host-api';
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

    it('should reject an id that is not 32 bytes without calling the host', async () => {
      const { container, payments } = setup();
      const handler = vi.fn<ContainerHandlerOf<typeof container.handlePaymentTopUp>>((_params, { ok }) =>
        ok(undefined),
      );
      container.handlePaymentTopUp(handler);

      // The strict Bytes(32) codec refuses to encode a wrong-length id; the
      // failure surfaces as the request's Unknown error carrying the reason.
      for (const id of [new Uint8Array(16), new Uint8Array(64)]) {
        const error = await payments.topUp(100n, { type: 'productAccount', derivationIndex: 0 }, id).then(
          () => null,
          (e: unknown) => e,
        );

        expect(error).toBeInstanceOf(PaymentTopUpErr.Unknown);
        expect((error as InstanceType<typeof PaymentTopUpErr.Unknown>).payload.reason).toMatch(/expected 32 bytes/);
      }
      expect(handler).not.toHaveBeenCalled();
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

    it('should interrupt with NotFound for an unknown id', () => {
      const { container, payments } = setup();

      container.handlePaymentTopUpStatusSubscribe((_id, _send, interrupt) => {
        // Raised synchronously on purpose: with an in-process host the interrupt
        // lands before the product's subscribe() returns and must not be lost.
        interrupt(new PaymentTopUpStatusErr.NotFound());
        return noop;
      });

      const interrupted = vi.fn();
      payments.subscribeTopUpStatus(new Uint8Array(32).fill(0xff), noop).onInterrupt(interrupted);

      expect(interrupted).toHaveBeenCalledWith(expect.any(PaymentTopUpStatusErr.NotFound));
    });

    it('should throw for an id that is not 32 bytes without contacting the host', () => {
      const { container, payments } = setup();
      const handler = vi.fn<ContainerHandlerOf<typeof container.handlePaymentTopUpStatusSubscribe>>(() => noop);
      container.handlePaymentTopUpStatusSubscribe(handler);

      // The start payload is encoded synchronously, so the strict codec throws before anything is sent.
      expect(() => payments.subscribeTopUpStatus(new Uint8Array(16), noop)).toThrow(/expected 32 bytes/);
      expect(() => payments.subscribeTopUpStatus(new Uint8Array(64), noop)).toThrow(/expected 32 bytes/);
      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('requestPayment', () => {
    const destination = new Uint8Array(32).fill(0xab);
    const paymentId = new Uint8Array(32).fill(0xc3);

    it('should resolve once the host accepts the payment', async () => {
      const { container, payments } = setup();

      container.handlePaymentRequest((_params, { ok }) => ok(undefined));

      await expect(payments.requestPayment(500n, destination, paymentId)).resolves.toBeUndefined();
    });

    it('should pass amount, destination and id to handler', async () => {
      const { container, payments } = setup();
      const handler = vi.fn<ContainerHandlerOf<typeof container.handlePaymentRequest>>((_params, { ok }) =>
        ok(undefined),
      );
      container.handlePaymentRequest(handler);

      await payments.requestPayment(300n, destination, paymentId);

      expect(handler).toHaveBeenCalledWith({ amount: 300n, destination, id: paymentId }, expect.anything());
    });

    it('should round-trip the id to the status subscription unchanged', async () => {
      const { container, payments } = setup();
      const id = Uint8Array.from({ length: 32 }, (_, i) => i);
      const requested: Uint8Array[] = [];
      const subscribed: Uint8Array[] = [];

      container.handlePaymentRequest((params, { ok }) => {
        requested.push(params.id);
        return ok(undefined);
      });
      container.handlePaymentStatusSubscribe((statusId, send, _interrupt) => {
        subscribed.push(statusId);
        send({ tag: 'Completed', value: undefined });
        return noop;
      });

      await payments.requestPayment(300n, destination, id);
      const statuses: PaymentStatus[] = [];
      payments.subscribePaymentStatus(id, s => statuses.push(s));

      await delay(50);

      expect(requested).toEqual([id]);
      expect(subscribed).toEqual([id]);
      expect(statuses).toEqual([{ type: 'completed' }]);
    });

    it('should pass the selected purse (from) to handler', async () => {
      const { container, payments } = setup();
      const handler = vi.fn<ContainerHandlerOf<typeof container.handlePaymentRequest>>((_params, { ok }) =>
        ok(undefined),
      );
      container.handlePaymentRequest(handler);

      await payments.requestPayment(300n, destination, paymentId, 9);

      expect(handler).toHaveBeenCalledWith({ from: 9, amount: 300n, destination, id: paymentId }, expect.anything());
    });

    it('should reject with AlreadyExists when the id is already registered', async () => {
      const { container, payments } = setup();

      container.handlePaymentRequest((_params, { err }) => err(new PaymentRequestErr.AlreadyExists()));

      await expect(payments.requestPayment(100n, destination, paymentId)).rejects.toBeInstanceOf(
        PaymentRequestErr.AlreadyExists,
      );
    });

    it('should reject with Rejected', async () => {
      const { container, payments } = setup();

      container.handlePaymentRequest((_params, { err }) => err(new PaymentRequestErr.Rejected()));

      await expect(payments.requestPayment(100n, destination, paymentId)).rejects.toBeInstanceOf(
        PaymentRequestErr.Rejected,
      );
    });

    it('should reject with InsufficientBalance', async () => {
      const { container, payments } = setup();

      container.handlePaymentRequest((_params, { err }) => err(new PaymentRequestErr.InsufficientBalance()));

      await expect(payments.requestPayment(100n, destination, paymentId)).rejects.toBeInstanceOf(
        PaymentRequestErr.InsufficientBalance,
      );
    });

    it('should reject an id that is not 32 bytes without calling the host', async () => {
      const { container, payments } = setup();
      const handler = vi.fn<ContainerHandlerOf<typeof container.handlePaymentRequest>>((_params, { ok }) =>
        ok(undefined),
      );
      container.handlePaymentRequest(handler);

      for (const id of [new Uint8Array(16), new Uint8Array(64)]) {
        const error = await payments.requestPayment(100n, destination, id).then(
          () => null,
          (e: unknown) => e,
        );

        expect(error).toBeInstanceOf(PaymentRequestErr.Unknown);
        expect((error as InstanceType<typeof PaymentRequestErr.Unknown>).payload.reason).toMatch(/expected 32 bytes/);
      }
      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('subscribePaymentStatus', () => {
    const paymentId = new Uint8Array(32).fill(0xc3);

    it('should deliver Processing then Completed', async () => {
      const { container, payments } = setup();

      container.handlePaymentStatusSubscribe((_paymentId, send, _interrupt) => {
        send({ tag: 'Processing', value: undefined });
        send({ tag: 'Completed', value: undefined });
        return noop;
      });

      const statuses: PaymentStatus[] = [];
      payments.subscribePaymentStatus(paymentId, s => statuses.push(s));

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
      payments.subscribePaymentStatus(paymentId, s => statuses.push(s));

      await delay(50);

      expect(statuses).toEqual([{ type: 'failed', reason: 'insufficient recycler vouchers' }]);
    });

    it('should deliver PartiallyClaimed with the amount that reached the destination', async () => {
      const { container, payments } = setup();

      container.handlePaymentStatusSubscribe((_paymentId, send, _interrupt) => {
        send({ tag: 'Processing', value: undefined });
        send({ tag: 'PartiallyClaimed', value: 40n });
        return noop;
      });

      const statuses: PaymentStatus[] = [];
      payments.subscribePaymentStatus(paymentId, s => statuses.push(s));

      await delay(50);

      expect(statuses).toEqual([{ type: 'processing' }, { type: 'partiallyClaimed', actualClaimed: 40n }]);
    });

    it('should pass payment id to handler', async () => {
      const { container, payments } = setup();
      const handler = vi.fn<ContainerHandlerOf<typeof container.handlePaymentStatusSubscribe>>(() => noop);
      container.handlePaymentStatusSubscribe(handler);

      const id = new Uint8Array(32).fill(0xd4);
      payments.subscribePaymentStatus(id, noop);

      await delay(50);

      expect(handler).toHaveBeenCalledWith(id, expect.anything(), expect.anything());
    });

    it('should interrupt with PaymentNotFound for an unknown id', () => {
      const { container, payments } = setup();

      container.handlePaymentStatusSubscribe((_paymentId, _send, interrupt) => {
        interrupt(new PaymentStatusErr.PaymentNotFound());
        return noop;
      });

      const interrupted = vi.fn();
      payments.subscribePaymentStatus(new Uint8Array(32).fill(0xff), noop).onInterrupt(interrupted);

      expect(interrupted).toHaveBeenCalledWith(expect.any(PaymentStatusErr.PaymentNotFound));
    });

    it('should throw for an id that is not 32 bytes without contacting the host', () => {
      const { container, payments } = setup();
      const handler = vi.fn<ContainerHandlerOf<typeof container.handlePaymentStatusSubscribe>>(() => noop);
      container.handlePaymentStatusSubscribe(handler);

      expect(() => payments.subscribePaymentStatus(new Uint8Array(16), noop)).toThrow(/expected 32 bytes/);
      expect(() => payments.subscribePaymentStatus(new Uint8Array(64), noop)).toThrow(/expected 32 bytes/);
      expect(handler).not.toHaveBeenCalled();
    });
  });
});
