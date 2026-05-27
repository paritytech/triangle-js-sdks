import type { CodecType, PaymentBalanceErr, Subscription, Transport } from '@novasamatech/host-api';
import { createHostApi, enumValue } from '@novasamatech/host-api';

import { resultToPromise, unwrapVersionedResult } from './helpers.js';
import { sandboxTransport } from './sandboxTransport.js';

export type PaymentBalance = {
  available: bigint;
};

export type PaymentStatus = { type: 'processing' } | { type: 'completed' } | { type: 'failed'; reason: string };

export type TopUpSource = { type: 'productAccount'; derivationIndex: number } | { type: 'privateKey'; key: Uint8Array };

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

    topUp(amount: bigint, source: TopUpSource, into?: PurseId): Promise<void> {
      const sourceCodec =
        source.type === 'productAccount'
          ? {
              tag: 'ProductAccount' as const,
              value: source.derivationIndex,
            }
          : { tag: 'PrivateKey' as const, value: source.key };

      return resultToPromise(
        unwrapVersionedResult(version, hostApi.paymentTopUp(enumValue(version, { into, amount, source: sourceCodec }))),
      );
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
