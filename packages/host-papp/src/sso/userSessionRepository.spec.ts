import { createAccountId, createLocalSessionAccount, createRemoteSessionAccount } from '@novasamatech/statement-store';
import type { StorageAdapter } from '@novasamatech/storage-adapter';
import { okAsync } from 'neverthrow';
import { toHex } from 'polkadot-api/utils';
import { describe, expect, it } from 'vitest';

import { createStoredUserSession, createUserSessionRepository } from './userSessionRepository.js';

const bytes = (len: number, fill: number) => new Uint8Array(len).fill(fill);

// remoteAccount.publicKey is a fixed 32-byte field (the SSO shared secret),
// which is exactly why the peer device's 65-byte encryption key needs its own
// `deviceEncPubKey` field rather than being squeezed in here.
const SHARED_SECRET = bytes(32, 0x07);
const DEVICE_ENC_PUB = bytes(65, 0x04);

const baseExtras = {
  identityAccountId: createAccountId(bytes(32, 0x11)),
  identityChatPublicKey: bytes(65, 0x22),
  ssoEncPubKey: bytes(65, 0x33),
  rootEntropySource: bytes(32, 0x44),
};

const makeSession = (deviceEncPubKey: Uint8Array = DEVICE_ENC_PUB) =>
  createStoredUserSession(
    createLocalSessionAccount(createAccountId(bytes(32, 0x01))),
    createRemoteSessionAccount(createAccountId(bytes(32, 0x02)), SHARED_SECRET),
    createAccountId(bytes(32, 0x55)),
    { ...baseExtras, deviceEncPubKey },
  );

const inMemoryStorage = (): StorageAdapter => {
  const store = new Map<string, string>();
  return {
    write: (key, value) => {
      store.set(key, value);
      return okAsync(undefined);
    },
    read: key => okAsync(store.get(key) ?? null),
    clear: key => {
      store.delete(key);
      return okAsync(undefined);
    },
    subscribe: () => () => undefined,
  };
};

describe('userSessionRepository — deviceEncPubKey persistence', () => {
  it('round-trips deviceEncPubKey through SCALE persistence', async () => {
    const repo = createUserSessionRepository(inMemoryStorage());

    await repo.add(makeSession(DEVICE_ENC_PUB));
    const stored = (await repo.read())._unsafeUnwrap().at(0);

    expect(stored?.deviceEncPubKey && toHex(stored.deviceEncPubKey)).toBe(toHex(DEVICE_ENC_PUB));
    // The 32-byte SSO shared secret stays in remoteAccount.publicKey, untouched.
    expect(stored && toHex(stored.remoteAccount.publicKey)).toBe(toHex(SHARED_SECRET));
  });
});
