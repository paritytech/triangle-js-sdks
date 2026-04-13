import { mergeUint8 } from 'polkadot-api/utils';
import { Bytes } from 'scale-ts';

import { khash, stringToBytes } from '../crypto.js';
import type { Branded } from '../types.js';

import type { SessionAccount } from './sessionAccount.js';

export type SessionId = Branded<Uint8Array, 'SessionId'>;
export const SessionIdCodec = Bytes(32);
export function createSessionId(sharedSecret: Uint8Array, accountA: SessionAccount, accountB: SessionAccount) {
  const sessionPrefix = stringToBytes('session');
  const pinSeparator = stringToBytes('/');

  function makePin(pin?: string) {
    return pin ? mergeUint8([pinSeparator, stringToBytes(pin)]) : pinSeparator;
  }

  const accountSessionParams = mergeUint8([
    accountA.accountId,
    accountB.accountId,
    makePin(accountA.pin),
    makePin(accountB.pin),
  ]);

  return khash(sharedSecret, mergeUint8([sessionPrefix, accountSessionParams])) as SessionId;
}
