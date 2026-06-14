import { LegacyTransaction, ProductAccountTransaction } from '@novasamatech/host-api';
import { Enum } from '@novasamatech/scale';
import type { CodecType } from 'scale-ts';
import { Bytes, Result, Struct, str } from 'scale-ts';

export type CreateTransactionRequest = CodecType<typeof CreateTransactionRequestCodec>;
export const CreateTransactionRequestCodec = Struct({
  payload: Enum({
    v1: ProductAccountTransaction,
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
