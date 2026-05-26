import { Enum, ErrEnum } from '@novasamatech/scale';
import { Bytes, Option, Result, Struct, _void, str, u128, u32 } from 'scale-ts';

import { GenericErr } from '../commonCodecs.js';

import { DerivationIndex } from './accounts.js';

// common types

export const Ed25519PrivateKey = Bytes(32);

export const PaymentId = str;

// Optional purse selector (RFC 0017). `undefined` (None) targets MAIN_PURSE.
export const CoinPaymentPurseId = u32;

export const PaymentTopUpSource = Enum({
  ProductAccount: DerivationIndex,
  PrivateKey: Ed25519PrivateKey,
});

export const PaymentBalance = Struct({
  available: u128,
});

export const PaymentReceipt = Struct({
  id: PaymentId,
});

export const PaymentStatus = Enum({
  Processing: _void,
  Completed: _void,
  Failed: str,
});

// errors

export const PaymentBalanceErr = ErrEnum('PaymentBalanceErr', {
  PermissionDenied: [_void, 'permission denied'],
  Unknown: [GenericErr, 'unknown error'],
});

export const PaymentTopUpErr = ErrEnum('PaymentTopUpErr', {
  InsufficientFunds: [_void, 'insufficient funds'],
  InvalidSource: [_void, 'invalid source'],
  Unknown: [GenericErr, 'unknown error'],
});

export const PaymentRequestErr = ErrEnum('PaymentRequestErr', {
  Rejected: [_void, 'rejected'],
  InsufficientBalance: [_void, 'insufficient balance'],
  Unknown: [GenericErr, 'unknown error'],
});

export const PaymentStatusErr = ErrEnum('PaymentStatusErr', {
  PaymentNotFound: [_void, 'payment not found'],
  Unknown: [GenericErr, 'unknown error'],
});

// host_payment_balance_subscribe

export const PaymentBalanceSubscribeV1_start = Struct({
  purse: Option(CoinPaymentPurseId),
});
export const PaymentBalanceSubscribeV1_receive = PaymentBalance;
export const PaymentBalanceSubscribeV1_interrupt = PaymentBalanceErr;

// host_payment_top_up

export const PaymentTopUpV1_request = Struct({
  into: Option(CoinPaymentPurseId),
  amount: u128,
  source: PaymentTopUpSource,
});
export const PaymentTopUpV1_response = Result(_void, PaymentTopUpErr);

// host_payment_request

export const PaymentRequestV1_request = Struct({
  from: Option(CoinPaymentPurseId),
  amount: u128,
  destination: Bytes(32),
});
export const PaymentRequestV1_response = Result(PaymentReceipt, PaymentRequestErr);

// host_payment_status_subscribe

export const PaymentStatusSubscribeV1_start = PaymentId;
export const PaymentStatusSubscribeV1_receive = PaymentStatus;
export const PaymentStatusSubscribeV1_interrupt = PaymentStatusErr;
