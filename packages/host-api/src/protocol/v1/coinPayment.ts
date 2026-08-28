import { Enum, ErrEnum, Hex, Status } from '@novasamatech/scale';
import { Struct, Tuple, Vector, _void, str, u32, u64 } from 'scale-ts';

import { CallResult } from '../callError.js';

// RFC 0017 CoinPayment shared types.

// Purse identifier. `0xffffffff` (u32::MAX) is the well-known MAIN_PURSE.
export const CoinPaymentPurseId = u32;
export const CoinPaymentBalance = u32;
// Milliseconds since the Unix epoch.
export const CoinPaymentTimestamp = u64;
export const CoinPaymentProductId = str;
// Public key identifying a receivable, and the 32-byte clearing leaves.
export const CoinPaymentReceivable = Hex(32);
export const CoinPaymentMerkleRoot = Hex(32);
export const CoinPaymentTransactionHash = Hex(32);
export const CoinPaymentCoinagePubKey = Hex(32);

export const CoinPaymentPurseInfo = Struct({
  name: str,
  created: CoinPaymentTimestamp,
  creator: CoinPaymentProductId,
  balance: CoinPaymentBalance,
});

export const CoinPaymentCheque = Struct({
  id: CoinPaymentReceivable,
  amount: CoinPaymentBalance,
  encryptedSecrets: Hex(),
});

// The nine CoinPaymentError variants, in wire order. Used as a plain value
// inside a clearing status; `CoinPaymentErr` below is the same set as a
// neverthrow error for the method and interrupt paths.
export const CoinPaymentErrorValue = Status(
  'BalanceLow',
  'Denied',
  'BadCoins',
  'SnipedCoins',
  'PurseNotFound',
  'ReceivableNotFound',
  'UnsupportedChannel',
  'UserAgentCapabilityUnavailable',
  'Internal',
);

export const CoinPaymentErr = ErrEnum('CoinPaymentErr', {
  BalanceLow: [_void, 'coin payment: source purse has too little balance'],
  Denied: [_void, 'coin payment: user agent denied the operation'],
  BadCoins: [_void, 'coin payment: coin secrets do not control valid coins'],
  SnipedCoins: [_void, 'coin payment: coin secrets were claimed elsewhere'],
  PurseNotFound: [_void, 'coin payment: purse not found'],
  ReceivableNotFound: [_void, 'coin payment: receivable not found'],
  UnsupportedChannel: [_void, 'coin payment: transmission channel not supported'],
  UserAgentCapabilityUnavailable: [_void, 'coin payment: user agent capability unavailable'],
  Internal: [_void, 'coin payment: internal error'],
});

export const CoinPaymentClearingReference = Struct({
  root: CoinPaymentMerkleRoot,
  leaves: Vector(Tuple(CoinPaymentCoinagePubKey, CoinPaymentTransactionHash)),
});

// Clearing status stream item shared by rebalance, delete, deposit, and refund.
export const CoinPaymentStatus = Enum({
  Clearing: Struct({ clearing: CoinPaymentBalance, cleared: CoinPaymentBalance }),
  Failed: Struct({
    error: CoinPaymentErrorValue,
    cleared: CoinPaymentBalance,
    reference: CoinPaymentClearingReference,
  }),
  Done: Struct({ cleared: CoinPaymentBalance, reference: CoinPaymentClearingReference }),
});

export const CoinPaymentTransmissionChannel = Enum({
  Standard: Struct({ sssTopic: Hex(32) }),
});

export const CoinPaymentListenForItem = Enum({
  Channel: CoinPaymentTransmissionChannel,
  Cheque: CoinPaymentCheque,
});

// host_coin_payment_create_purse (136)
export const CoinPaymentCreatePurseV1_request = Struct({ name: str });
export const CoinPaymentCreatePurseV1_response = CallResult(Struct({ purse: CoinPaymentPurseId }), CoinPaymentErr);

// host_coin_payment_query_purse (138)
export const CoinPaymentQueryPurseV1_request = Struct({ purse: CoinPaymentPurseId });
export const CoinPaymentQueryPurseV1_response = CallResult(Struct({ info: CoinPaymentPurseInfo }), CoinPaymentErr);

// host_coin_payment_rebalance_purse (140)
export const CoinPaymentRebalancePurseV1_start = Struct({
  from: CoinPaymentPurseId,
  to: CoinPaymentPurseId,
  amount: CoinPaymentBalance,
});
export const CoinPaymentRebalancePurseV1_receive = CoinPaymentStatus;
export const CoinPaymentRebalancePurseV1_interrupt = CoinPaymentErr;

// host_coin_payment_delete_purse (144)
export const CoinPaymentDeletePurseV1_start = Struct({
  target: CoinPaymentPurseId,
  drainInto: CoinPaymentPurseId,
});
export const CoinPaymentDeletePurseV1_receive = CoinPaymentStatus;
export const CoinPaymentDeletePurseV1_interrupt = CoinPaymentErr;

// host_coin_payment_create_receivable (148)
export const CoinPaymentCreateReceivableV1_request = Struct({ into: CoinPaymentPurseId });
export const CoinPaymentCreateReceivableV1_response = CallResult(
  Struct({ receivable: CoinPaymentReceivable }),
  CoinPaymentErr,
);

// host_coin_payment_create_cheque (150)
export const CoinPaymentCreateChequeV1_request = Struct({
  from: CoinPaymentPurseId,
  to: CoinPaymentReceivable,
  amount: CoinPaymentBalance,
});
export const CoinPaymentCreateChequeV1_response = CallResult(Struct({ cheque: CoinPaymentCheque }), CoinPaymentErr);

// host_coin_payment_deposit (152)
export const CoinPaymentDepositV1_start = Struct({ cheque: CoinPaymentCheque });
export const CoinPaymentDepositV1_receive = CoinPaymentStatus;
export const CoinPaymentDepositV1_interrupt = CoinPaymentErr;

// host_coin_payment_refund (156)
export const CoinPaymentRefundV1_start = Struct({ receivable: CoinPaymentReceivable });
export const CoinPaymentRefundV1_receive = CoinPaymentStatus;
export const CoinPaymentRefundV1_interrupt = CoinPaymentErr;

// host_coin_payment_listen_for_payment (160)
export const CoinPaymentListenForPaymentV1_start = Struct({ receivable: CoinPaymentReceivable });
export const CoinPaymentListenForPaymentV1_receive = CoinPaymentListenForItem;
export const CoinPaymentListenForPaymentV1_interrupt = CoinPaymentErr;
