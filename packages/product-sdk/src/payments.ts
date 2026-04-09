import type { Subscription, Transport } from '@novasamatech/host-api';
import { createHostApi, enumValue } from '@novasamatech/host-api';

import { resultToPromise, unwrapVersionedResult } from './helpers.js';
import { sandboxTransport } from './sandboxTransport.js';

export type PaymentBalance = {
  available: bigint;
};

export type PaymentStatus = { type: 'processing' } | { type: 'completed' } | { type: 'failed'; reason: string };

export type TopUpSource =
  | { type: 'productAccount'; dotNsIdentifier: string; derivationIndex: number }
  | { type: 'privateKey'; key: Uint8Array };

export const createPaymentManager = (transport: Transport = sandboxTransport) => {
  const hostApi = createHostApi(transport);
  const version = 'v1' as const;

  return {
    subscribeBalance(callback: (balance: PaymentBalance) => void): Subscription {
      return hostApi.paymentBalanceSubscribe(enumValue(version, undefined), payload => {
        if (payload.tag === version) {
          callback(payload.value);
        }
      });
    },

    topUp(amount: bigint, source: TopUpSource): Promise<void> {
      const sourceCodec =
        source.type === 'productAccount'
          ? {
              tag: 'ProductAccount' as const,
              value: [source.dotNsIdentifier, source.derivationIndex] as [string, number],
            }
          : { tag: 'PrivateKey' as const, value: source.key };

      return resultToPromise(
        unwrapVersionedResult(version, hostApi.paymentTopUp(enumValue(version, { amount, source: sourceCodec }))),
      );
    },

    requestPayment(amount: bigint, destination: Uint8Array): Promise<{ id: string }> {
      return resultToPromise(
        unwrapVersionedResult(version, hostApi.paymentRequest(enumValue(version, { amount, destination }))),
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
