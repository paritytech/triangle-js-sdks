import { Enum, ErrEnum } from '@novasamatech/scale';
import { Bytes, Result, Struct, _void, str, u128 } from 'scale-ts';

import { GenericErr } from '../commonCodecs.js';

import { ProductAccountId } from './accounts.js';

// common types

export const Ed25519PrivateKey = Bytes(32);

export const PaymentId = str;

export const PaymentTopUpSource = Enum({
  ProductAccount: ProductAccountId,
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

export const PaymentBalanceSubscribeV1_start = _void;
export const PaymentBalanceSubscribeV1_receive = PaymentBalance;

// host_payment_top_up

export const PaymentTopUpV1_request = Struct({
  amount: u128,
  source: PaymentTopUpSource,
});
export const PaymentTopUpV1_response = Result(_void, PaymentTopUpErr);

// host_payment_request

export const PaymentRequestV1_request = Struct({
  amount: u128,
  destination: Bytes(32),
});
export const PaymentRequestV1_response = Result(PaymentReceipt, PaymentRequestErr);

// host_payment_status_subscribe

export const PaymentStatusSubscribeV1_start = PaymentId;
export const PaymentStatusSubscribeV1_receive = PaymentStatus;
