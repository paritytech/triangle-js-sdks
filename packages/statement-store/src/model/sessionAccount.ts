import { Bytes } from '@novasamatech/scale';
import { Option, Struct, str } from 'scale-ts';

import { BrandedBytesCodec } from '../crypto.js';
import type { Branded } from '../types.js';

export type AccountId = Branded<Uint8Array, 'AccountId'>;
export const AccountIdCodec = BrandedBytesCodec<AccountId>(32);
export function createAccountId(value: Uint8Array): AccountId {
  return value.slice(0, 32) as AccountId;
}

export type SessionAccount = {
  accountId: AccountId;
  pin: string | undefined;
};

export type LocalSessionAccount = SessionAccount;
export const LocalSessionAccountCodec = Struct({
  accountId: AccountIdCodec,
  pin: Option(str),
});
export function createLocalSessionAccount(accountId: AccountId, pin?: string): LocalSessionAccount {
  return {
    accountId,
    pin,
  };
}

export type RemoteSessionAccount = SessionAccount & {
  publicKey: Uint8Array;
};
export const RemoteSessionAccountCodec = Struct({
  accountId: AccountIdCodec,
  publicKey: Bytes(32),
  pin: Option(str),
});
export function createRemoteSessionAccount(
  accountId: AccountId,
  publicKey: Uint8Array,
  pin?: string,
): RemoteSessionAccount {
  return {
    accountId,
    publicKey,
    pin,
  };
}
