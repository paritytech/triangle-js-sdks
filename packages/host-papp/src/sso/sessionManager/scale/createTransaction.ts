import { LegacyTransaction, ProductAccountId } from '@novasamatech/host-api';
import { Bytes, Enum, Hex } from '@novasamatech/scale';
import type { CodecType } from 'scale-ts';
import { Result, Struct, Vector, str, u8 } from 'scale-ts';

/**
 * A product-account transaction as it crosses to the signing host: host-api's
 * `ProductAccountTransaction` without `contacts`. The pairing host substitutes
 * every declared contact handle in `callData` before relaying, so the signing
 * host has none to resolve and the wire keeps the shape existing wallets
 * decode (truapi's `SsoProductTxPayload`).
 */
const SsoProductTransaction = Struct({
  signer: ProductAccountId,
  genesisHash: Hex(32),
  callData: Bytes(),
  extensions: Vector(
    Struct({
      id: str,
      extra: Bytes(),
      additionalSigned: Bytes(),
    }),
  ),
  txExtVersion: u8,
});

export type CreateTransactionRequest = CodecType<typeof CreateTransactionRequestCodec>;
export const CreateTransactionRequestCodec = Struct({
  payload: Enum({
    v1: SsoProductTransaction,
  }),
});

export type CreateTransactionLegacyRequest = CodecType<typeof CreateTransactionLegacyRequestCodec>;
export const CreateTransactionLegacyRequestCodec = Struct({
  payload: Enum({
    v1: LegacyTransaction,
  }),
});

export type CreateTransactionResponse = CodecType<typeof CreateTransactionResponseCodec>;
export const CreateTransactionResponseCodec = Struct({
  // referencing to RemoteMessage.messageId
  respondingTo: str,
  signedTransaction: Result(Bytes(), str),
});
