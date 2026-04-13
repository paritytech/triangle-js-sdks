import { gcm } from '@noble/ciphers/aes.js';
import { blake2b } from '@noble/hashes/blake2.js';
import type { StorageAdapter } from '@novasamatech/storage-adapter';
import type { ResultAsync } from 'neverthrow';
import { fromThrowable } from 'neverthrow';
import { fromHex, toHex } from 'polkadot-api/utils';
import type { CodecType } from 'scale-ts';
import { Bytes, Struct } from 'scale-ts';

import type { EncrSecret, SsSecret } from '../crypto.js';
import { BrandedBytesCodec, stringToBytes } from '../crypto.js';
import { toError } from '../helpers/utils.js';

type StoredUserSecrets = CodecType<typeof StoredUserSecretsCodec>;
const StoredUserSecretsCodec = Struct({
  ssSecret: BrandedBytesCodec<SsSecret>(),
  encrSecret: BrandedBytesCodec<EncrSecret>(),
  entropy: Bytes(),
});

export type UserSecretRepository = ReturnType<typeof createUserSecretRepository>;

export function createUserSecretRepository(salt: string, storage: StorageAdapter) {
  const baseKey = 'UserSecrets';

  const encode = fromThrowable(StoredUserSecretsCodec.enc, toError);
  const decode = fromThrowable(
    (value: Uint8Array | null) => (value ? StoredUserSecretsCodec.dec(value) : null),
    toError,
  );

  const encrypt = fromThrowable((value: Uint8Array) => {
    const aes = getAes(salt);
    return toHex(aes.encrypt(value));
  }, toError);

  const decrypt = fromThrowable((value: string | null) => {
    if (value === null) {
      return null;
    }
    const aes = getAes(salt);
    return aes.decrypt(fromHex(value));
  }, toError);

  return {
    read(sessionId: string): ResultAsync<StoredUserSecrets | null, Error> {
      return storage.read(createKey(baseKey, sessionId)).andThen(decrypt).andThen(decode);
    },
    write(sessionId: string, value: StoredUserSecrets) {
      return encode(value)
        .andThen(encrypt)
        .asyncAndThen(value => storage.write(createKey(baseKey, sessionId), value));
    },
    clear(sessionId: string) {
      return storage.clear(createKey(baseKey, sessionId));
    },
  };
}

const createKey = (key: string, context: string) => `${key}_${context}`;

function getAes(salt: string) {
  return gcm(blake2b(stringToBytes(salt), { dkLen: 16 }), blake2b(stringToBytes('nonce'), { dkLen: 32 }));
}
