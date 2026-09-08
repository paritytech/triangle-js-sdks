import { Bytes, Enum, ErrEnum } from '@novasamatech/scale';
import { Option, Struct, Vector, _void, bool, str, u128, u32 } from 'scale-ts';

import { CallResult } from '../callError.js';
import { GenericErr } from '../commonCodecs.js';

import { DerivationIndex } from './accounts.js';

// common types

export const Sr25519SecretKey = Bytes(64);

export const PaymentId = str;

/** Product-supplied, opaque 32-byte idempotency key for a top up. */
export const PaymentTopUpId = Bytes(32);

// Optional purse selector (RFC 0017). `undefined` (None) targets MAIN_PURSE.
export const CoinPaymentPurseId = u32;

export const PaymentTopUpSource = Enum({
  // Account of the calling product, addressed by the RFC-0022 selector.
  ProductAccount: DerivationIndex,
  PrivateKey: Sr25519SecretKey,
  Coins: Vector(Sr25519SecretKey),
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

// A status never advances once it reaches a terminal variant (`Claimed` with
// `finalized`, `ClaimedPartially`, `NotClaimed`); the host takes no further
// action and keeps the status readable indefinitely.
export const PaymentTopUpStatus = Enum({
  // Waiting for the requested amount to appear on the source.
  Detecting: _void,
  Claiming: _void,
  // At least the requested amount was claimed. Terminal once `finalized`.
  Claimed: Struct({ finalized: bool }),
  // Terminal: the host could only claim `actualClaimed`, less than requested.
  // Usually means the source never held enough balance to cover the request —
  // e.g. a re-orged pre-funding transfer. Requesting an amount below the
  // smallest coinage denomination lands here too: the host claims
  // `amount - amount % 2^min_coinage_exponent`.
  ClaimedPartially: Struct({ actualClaimed: u128 }),
  // Terminal: nothing could be claimed, most likely because the host never
  // observed any balance at the source.
  NotClaimed: _void,
});

// errors

export const PaymentBalanceErr = ErrEnum('PaymentBalanceErr', {
  PermissionDenied: [_void, 'permission denied'],
  Unknown: [GenericErr, 'unknown error'],
});

export const PaymentTopUpErr = ErrEnum('PaymentTopUpErr', {
  InvalidSource: [_void, 'invalid source'],
  AlreadyExists: [_void, 'a top up with this id already exists'],
  // Only one top up can be live per source; the source frees up once the
  // previous top up reaches a terminal status.
  SourceBusy: [_void, 'source already has a top up in progress'],
  Unknown: [GenericErr, 'unknown error'],
});

export const PaymentTopUpStatusErr = ErrEnum('PaymentTopUpStatusErr', {
  NotFound: [_void, 'top up not found'],
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
  id: PaymentTopUpId,
});
export const PaymentTopUpV1_response = CallResult(_void, PaymentTopUpErr);

// host_payment_request

export const PaymentRequestV1_request = Struct({
  from: Option(CoinPaymentPurseId),
  amount: u128,
  destination: Bytes(32),
});
export const PaymentRequestV1_response = CallResult(PaymentReceipt, PaymentRequestErr);

// host_payment_status_subscribe

export const PaymentStatusSubscribeV1_start = PaymentId;
export const PaymentStatusSubscribeV1_receive = PaymentStatus;
export const PaymentStatusSubscribeV1_interrupt = PaymentStatusErr;

// host_payment_top_up_status_subscribe

export const PaymentTopUpStatusSubscribeV1_start = PaymentTopUpId;
export const PaymentTopUpStatusSubscribeV1_receive = PaymentTopUpStatus;
export const PaymentTopUpStatusSubscribeV1_interrupt = PaymentTopUpStatusErr;
