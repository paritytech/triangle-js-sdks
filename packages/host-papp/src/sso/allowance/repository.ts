import { gcm } from '@noble/ciphers/aes.js';
import { blake2b } from '@noble/hashes/blake2.js';
import type { StorageAdapter } from '@novasamatech/storage-adapter';
import type { ResultAsync } from 'neverthrow';
import { fromThrowable } from 'neverthrow';
import { fromHex, toHex } from 'polkadot-api/utils';
import type { CodecType } from 'scale-ts';
import { Bytes, Enum, Struct, Vector, _void, str } from 'scale-ts';

import { stringToBytes } from '../../crypto.js';
import { toError } from '../../helpers/utils.js';

export type AllowanceResourceKind = 'bulletin' | 'statementStore';

const AllowanceResourceKindCodec = Enum({
  bulletin: _void,
  statementStore: _void,
});

type StoredAllowanceEntry = CodecType<typeof StoredAllowanceEntryCodec>;
const StoredAllowanceEntryCodec = Struct({
  productId: str,
  resource: AllowanceResourceKindCodec,
  slotAccountKey: Bytes(),
});

const StoredAllowancesCodec = Vector(StoredAllowanceEntryCodec);

export type AllowanceRepository = ReturnType<typeof createAllowanceRepository>;

export function createAllowanceRepository(salt: string, storage: StorageAdapter) {
  const baseKey = 'AllowanceKeys';

  const encode = fromThrowable(StoredAllowancesCodec.enc, toError);
  const decode = fromThrowable((value: Uint8Array | null) => (value ? StoredAllowancesCodec.dec(value) : []), toError);

  const encrypt = fromThrowable((value: Uint8Array) => {
    const aes = getAes(salt);
    return toHex(aes.encrypt(value));
  }, toError);

  const decrypt = fromThrowable((value: string | null) => {
    if (value === null) return null;
    const aes = getAes(salt);
    return aes.decrypt(fromHex(value));
  }, toError);

  const readAll = (sessionId: string): ResultAsync<StoredAllowanceEntry[], Error> =>
    storage.read(createKey(baseKey, sessionId)).andThen(decrypt).andThen(decode);

  const writeAll = (sessionId: string, entries: StoredAllowanceEntry[]) =>
    encode(entries)
      .andThen(encrypt)
      .asyncAndThen(value => storage.write(createKey(baseKey, sessionId), value));

  return {
    read(sessionId: string, productId: string, resource: AllowanceResourceKind): ResultAsync<Uint8Array | null, Error> {
      return readAll(sessionId).map(entries => {
        const entry = entries.find(e => e.productId === productId && e.resource.tag === resource);
        return entry ? entry.slotAccountKey : null;
      });
    },
    write(sessionId: string, productId: string, resource: AllowanceResourceKind, slotAccountKey: Uint8Array) {
      return readAll(sessionId).andThen(entries => {
        const next: StoredAllowanceEntry[] = [
          ...entries.filter(e => !(e.productId === productId && e.resource.tag === resource)),
          { productId, resource: { tag: resource, value: undefined }, slotAccountKey },
        ];
        return writeAll(sessionId, next);
      });
    },
    clearSession(sessionId: string) {
      return storage.clear(createKey(baseKey, sessionId));
    },
  };
}

const createKey = (key: string, context: string) => `${key}_${context}`;

function getAes(salt: string) {
  return gcm(blake2b(stringToBytes(salt), { dkLen: 16 }), blake2b(stringToBytes('nonce'), { dkLen: 32 }));
}
