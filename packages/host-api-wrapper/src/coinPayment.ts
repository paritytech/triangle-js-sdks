import type {
  CodecType,
  CoinPaymentCheque,
  CoinPaymentListenForItem,
  CoinPaymentPurseInfo,
  CoinPaymentStatus,
  HexString,
  Subscription,
  Transport,
} from '@novasamatech/host-api';
import { CoinPaymentErr, createHostApi, enumValue } from '@novasamatech/host-api';

import { resultToPromise, unwrapVersionedResult, unwrapVersionedSubscription } from './helpers.js';
import { sandboxTransport } from './sandboxTransport.js';

/** Purse identifier (RFC 0017). `0xffffffff` is the well-known main purse. */
export type PurseId = number;
/** Receivable public key, as a 0x-prefixed 32-byte hex string. */
export type Receivable = HexString;

export type PurseInfo = CodecType<typeof CoinPaymentPurseInfo>;
export type Cheque = CodecType<typeof CoinPaymentCheque>;
/** Clearing status streamed by rebalance, delete, deposit, and refund. */
export type ClearingStatus = CodecType<typeof CoinPaymentStatus>;
/** Item streamed by `listenForPayment`: a delivery channel, then the cheque. */
export type PaymentDelivery = CodecType<typeof CoinPaymentListenForItem>;

type CoinPaymentInterrupt = CodecType<typeof CoinPaymentErr>;

// `CoinPaymentErr` has no free-form variant; a transport failure is reported as `Internal`.
const coinPaymentInterrupt = (): CoinPaymentInterrupt => new CoinPaymentErr.Internal();

export const createCoinPayment = (transport: Transport = sandboxTransport) => {
  const hostApi = createHostApi(transport);
  const version = 'v1' as const;

  return {
    // Create a new firewalled purse and resolve with its assigned id.
    createPurse(name: string): Promise<PurseId> {
      return resultToPromise(
        unwrapVersionedResult(version, hostApi.coinPayment.createPurse(enumValue(version, { name }))),
      ).then(({ purse }) => purse);
    },

    // Query product-visible metadata and balance for a purse.
    queryPurse(purse: PurseId): Promise<PurseInfo> {
      return resultToPromise(
        unwrapVersionedResult(version, hostApi.coinPayment.queryPurse(enumValue(version, { purse }))),
      ).then(({ info }) => info);
    },

    // Create a fresh receivable public key for depositing into a purse.
    createReceivable(into: PurseId): Promise<Receivable> {
      return resultToPromise(
        unwrapVersionedResult(version, hostApi.coinPayment.createReceivable(enumValue(version, { into }))),
      ).then(({ receivable }) => receivable);
    },

    // Create a cheque paying from a local purse to a receivable.
    createCheque(from: PurseId, to: Receivable, amount: number): Promise<Cheque> {
      return resultToPromise(
        unwrapVersionedResult(version, hostApi.coinPayment.createCheque(enumValue(version, { from, to, amount }))),
      ).then(({ cheque }) => cheque);
    },

    // Transfer balance between local purses, streaming clearing status.
    rebalancePurse(
      from: PurseId,
      to: PurseId,
      amount: number,
      onStatus: (status: ClearingStatus) => void,
    ): Subscription<CoinPaymentInterrupt | undefined> {
      return unwrapVersionedSubscription(
        hostApi.coinPayment.rebalancePurse(enumValue(version, { from, to, amount }), payload => {
          if (payload.tag === version) onStatus(payload.value);
        }),
        coinPaymentInterrupt,
      );
    },

    // Delete a purse after draining its balance into another local purse.
    deletePurse(
      target: PurseId,
      drainInto: PurseId,
      onStatus: (status: ClearingStatus) => void,
    ): Subscription<CoinPaymentInterrupt | undefined> {
      return unwrapVersionedSubscription(
        hostApi.coinPayment.deletePurse(enumValue(version, { target, drainInto }), payload => {
          if (payload.tag === version) onStatus(payload.value);
        }),
        coinPaymentInterrupt,
      );
    },

    // Claim coins from a cheque into the receivable's purse.
    deposit(
      cheque: Cheque,
      onStatus: (status: ClearingStatus) => void,
    ): Subscription<CoinPaymentInterrupt | undefined> {
      return unwrapVersionedSubscription(
        hostApi.coinPayment.deposit(enumValue(version, { cheque }), payload => {
          if (payload.tag === version) onStatus(payload.value);
        }),
        coinPaymentInterrupt,
      );
    },

    // Attempt to return coins associated with a receivable.
    refund(
      receivable: Receivable,
      onStatus: (status: ClearingStatus) => void,
    ): Subscription<CoinPaymentInterrupt | undefined> {
      return unwrapVersionedSubscription(
        hostApi.coinPayment.refund(enumValue(version, { receivable }), payload => {
          if (payload.tag === version) onStatus(payload.value);
        }),
        coinPaymentInterrupt,
      );
    },

    // Listen for a cheque delivered through a standard transmission channel.
    listenForPayment(
      receivable: Receivable,
      onDelivery: (item: PaymentDelivery) => void,
    ): Subscription<CoinPaymentInterrupt | undefined> {
      return unwrapVersionedSubscription(
        hostApi.coinPayment.listenForPayment(enumValue(version, { receivable }), payload => {
          if (payload.tag === version) onDelivery(payload.value);
        }),
        coinPaymentInterrupt,
      );
    },
  };
};

export const hostCoinPayment = createCoinPayment();
