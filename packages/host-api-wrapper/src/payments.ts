import type {
  AccountSelector,
  CodecType,
  PaymentBalanceErr,
  PaymentTopUpStatusErr,
  Subscription,
  Transport,
} from '@novasamatech/host-api';
import { createHostApi, derivationIndexOf, enumValue } from '@novasamatech/host-api';

import { resultToPromise, unwrapVersionedResult } from './helpers.js';
import { sandboxTransport } from './sandboxTransport.js';

export type PaymentBalance = {
  available: bigint;
};

export type PaymentStatus = { type: 'processing' } | { type: 'completed' } | { type: 'failed'; reason: string };

/**
 * Progress of a `topUp`. `claimed` with `finalized: true`, `claimedPartially`
 * and `notClaimed` are terminal; the host sends nothing after them and takes no
 * further action, but keeps the status readable indefinitely.
 *
 * `claimedPartially` means the source never held enough to cover the requested
 * amount — a re-orged pre-funding transfer, most often; sending the remainder to
 * the source is the way out. It is also what an amount below the smallest
 * coinage denomination produces, the host claiming
 * `amount - amount % 2^min_coinage_exponent`. `notClaimed` most likely means the
 * host never observed any balance at the source at all.
 */
export type TopUpStatus =
  | { type: 'detecting' }
  | { type: 'claiming' }
  | { type: 'claimed'; finalized: boolean }
  | { type: 'claimedPartially'; actualClaimed: bigint }
  | { type: 'notClaimed' };

export type TopUpSource =
  /** `derivationIndex` is the RFC-0022 selector: a plain index or a raw 32-byte index. */
  | { type: 'productAccount'; derivationIndex: AccountSelector }
  | { type: 'privateKey'; key: Uint8Array }
  | { type: 'coins'; keys: Uint8Array[] };

/** CoinPayment purse identifier (RFC 0017). Omit to target the main purse. */
export type PurseId = number;

export const createPaymentManager = (transport: Transport = sandboxTransport) => {
  const hostApi = createHostApi(transport);
  const version = 'v1' as const;

  return {
    subscribeBalance(
      callback: (balance: PaymentBalance) => void,
      purse?: PurseId,
    ): Subscription<CodecType<typeof PaymentBalanceErr>> {
      const subscriber = hostApi.paymentBalanceSubscribe(enumValue(version, { purse }), payload => {
        if (payload.tag === version) {
          callback(payload.value);
        }
      });

      return {
        unsubscribe: subscriber.unsubscribe,
        onInterrupt: cb => subscriber.onInterrupt(v => cb(v.value)),
      };
    },

    /**
     * Registers a top up and resolves as soon as the host has accepted it — not
     * when the funds arrive. Once accepted, the host drives the top up to a
     * terminal status on its own, across a full host restart if need be.
     *
     * `id` is a 32-byte opaque identifier chosen by the product and is the
     * idempotency key: re-registering a known `id` rejects with `AlreadyExists`.
     * A source carries one live top up at a time — while the previous one has
     * not reached a terminal status, the call rejects with `SourceBusy`.
     * Track the outcome with `subscribeTopUpStatus(id)`.
     */
    topUp(amount: bigint, source: TopUpSource, id: Uint8Array, into?: PurseId): Promise<void> {
      const sourceCodec =
        source.type === 'productAccount'
          ? {
              tag: 'ProductAccount' as const,
              value: derivationIndexOf(source.derivationIndex),
            }
          : source.type === 'privateKey'
            ? { tag: 'PrivateKey' as const, value: source.key }
            : { tag: 'Coins' as const, value: source.keys };

      return resultToPromise(
        unwrapVersionedResult(
          version,
          hostApi.paymentTopUp(enumValue(version, { into, amount, source: sourceCodec, id })),
        ),
      );
    },

    /**
     * Follows a registered top up to its terminal status. Statuses are kept
     * indefinitely, so a subscription opened long after the fact still reports
     * the outcome. Interrupted with `PaymentTopUpStatusErr.NotFound` when the
     * host knows nothing about `id`.
     */
    subscribeTopUpStatus(
      id: Uint8Array,
      callback: (status: TopUpStatus) => void,
    ): Subscription<CodecType<typeof PaymentTopUpStatusErr>> {
      const subscriber = hostApi.paymentTopUpStatusSubscribe(enumValue(version, id), payload => {
        if (payload.tag !== version) return;

        const raw = payload.value;
        switch (raw.tag) {
          case 'Detecting':
            return callback({ type: 'detecting' });
          case 'Claiming':
            return callback({ type: 'claiming' });
          case 'Claimed':
            return callback({ type: 'claimed', finalized: raw.value.finalized });
          case 'ClaimedPartially':
            return callback({ type: 'claimedPartially', actualClaimed: raw.value.actualClaimed });
          case 'NotClaimed':
            return callback({ type: 'notClaimed' });
        }
      });

      return {
        unsubscribe: subscriber.unsubscribe,
        onInterrupt: cb => subscriber.onInterrupt(v => cb(v.value)),
      };
    },

    requestPayment(amount: bigint, destination: Uint8Array, from?: PurseId): Promise<{ id: string }> {
      return resultToPromise(
        unwrapVersionedResult(version, hostApi.paymentRequest(enumValue(version, { from, amount, destination }))),
      );
    },

    subscribePaymentStatus(id: string, callback: (status: PaymentStatus) => void): Subscription {
      return hostApi.paymentStatusSubscribe(enumValue(version, id), payload => {
        if (payload.tag === version) {
          const raw = payload.value;
          if (raw.tag === 'Processing') {
            callback({ type: 'processing' });
          } else if (raw.tag === 'Completed') {
            callback({ type: 'completed' });
          } else if (raw.tag === 'Failed') {
            callback({ type: 'failed', reason: raw.value });
          }
        }
      });
    },
  };
};

export const paymentManager = createPaymentManager();
