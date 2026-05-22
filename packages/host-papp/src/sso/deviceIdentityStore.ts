import { gcm } from '@noble/ciphers/aes.js';
import { blake2b } from '@noble/hashes/blake2.js';
import { createSr25519Secret, deriveSr25519PublicKey } from '@novasamatech/statement-store';
import type { StorageAdapter } from '@novasamatech/storage-adapter';
import type { ResultAsync } from 'neverthrow';
import { errAsync, fromPromise, okAsync } from 'neverthrow';
import { fromHex, toHex } from 'polkadot-api/utils';
import { Bytes, Option, Struct, str } from 'scale-ts';

import type { EncrPublicKey, EncrSecret, SsPublicKey, SsSecret } from '../crypto.js';
import { getEncrPub, stringToBytes } from '../crypto.js';
import { toError } from '../helpers/utils.js';

import type { DeviceIdentityForPairing } from './auth/v2/service.js';

const KEY = 'DeviceIdentity';

// Persisted shape — kept under appId-derived AES-GCM at rest, same pattern as
// UserSecretRepository.
const StoredDeviceCodec = Struct({
  statementAccountSeed: Bytes(32),
  encryptionPrivateKey: Bytes(32),
  lastProcessedHandshakeStatement: Option(str),
});

type Stored = {
  statementAccountSeed: Uint8Array;
  encryptionPrivateKey: Uint8Array;
  lastProcessedHandshakeStatement: string | undefined;
};

export type DeviceIdentity = DeviceIdentityForPairing & {
  statementAccountSecret: SsSecret;
};

export type DeviceIdentityStore = {
  loadOrCreate(): ResultAsync<DeviceIdentity, Error>;
  readLastProcessedHandshakeStatement(): ResultAsync<string | null, Error>;
  writeLastProcessedHandshakeStatement(hex: string): ResultAsync<void, Error>;
};

export function createDeviceIdentityStore(salt: string, storage: StorageAdapter): DeviceIdentityStore {
  const aes = () => gcm(blake2b(stringToBytes(salt), { dkLen: 16 }), blake2b(stringToBytes('nonce'), { dkLen: 32 }));

  const decode = (raw: string | null): Stored | null => {
    if (!raw) return null;
    try {
      const decrypted = aes().decrypt(fromHex(raw));
      return StoredDeviceCodec.dec(decrypted);
    } catch {
      // 0.7.x had no DeviceIdentity key; any decode failure here means a
      // schema rev or tampered blob — drop it and regenerate.
      return null;
    }
  };

  const encode = (stored: Stored): string => toHex(aes().encrypt(StoredDeviceCodec.enc(stored)));

  const read = (): ResultAsync<Stored | null, Error> => storage.read(KEY).map(decode);
  const write = (stored: Stored): ResultAsync<void, Error> => storage.write(KEY, encode(stored)).map(() => undefined);

  const expand = (stored: Stored): DeviceIdentity => {
    const statementAccountSecret = createSr25519Secret(stored.statementAccountSeed) as SsSecret;
    const statementAccountPublicKey = deriveSr25519PublicKey(statementAccountSecret) as SsPublicKey;
    const encryptionPrivateKey = stored.encryptionPrivateKey as EncrSecret;
    const encryptionPublicKey = getEncrPub(encryptionPrivateKey) as EncrPublicKey;
    return { statementAccountPublicKey, statementAccountSecret, encryptionPublicKey, encryptionPrivateKey };
  };

  const generate = (): Stored => ({
    statementAccountSeed: crypto.getRandomValues(new Uint8Array(32)),
    encryptionPrivateKey: crypto.getRandomValues(new Uint8Array(32)),
    lastProcessedHandshakeStatement: undefined,
  });

  return {
    loadOrCreate() {
      return read().andThen(existing => {
        if (existing) return okAsync(expand(existing));
        const fresh = generate();
        return write(fresh).map(() => expand(fresh));
      });
    },
    readLastProcessedHandshakeStatement() {
      return read().map(stored => stored?.lastProcessedHandshakeStatement ?? null);
    },
    writeLastProcessedHandshakeStatement(hex: string) {
      return read().andThen(existing => {
        if (!existing) {
          // No identity yet — caller will populate via loadOrCreate first.
          return errAsync<void, Error>(new Error('writeLastProcessedHandshakeStatement: no device identity persisted'));
        }
        return write({ ...existing, lastProcessedHandshakeStatement: hex });
      });
    },
  };
}

// Re-export the awaitable form for convenience, since most call sites already
// live in async functions.
export const awaitDeviceIdentity = (store: DeviceIdentityStore): Promise<DeviceIdentity> =>
  fromPromise(Promise.resolve(), toError)
    .andThen(() => store.loadOrCreate())
    .match(
      ok => ok,
      err => {
        throw err;
      },
    );
