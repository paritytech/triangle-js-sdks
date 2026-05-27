import type { AccountId, LocalSessionAccount, RemoteSessionAccount } from '@novasamatech/statement-store';
import { AccountIdCodec, LocalSessionAccountCodec, RemoteSessionAccountCodec } from '@novasamatech/statement-store';
import type { StorageAdapter } from '@novasamatech/storage-adapter';
import { fieldListView } from '@novasamatech/storage-adapter';
import { nanoid } from 'nanoid';
import { fromHex, toHex } from 'polkadot-api/utils';
import type { CodecType } from 'scale-ts';
import { Bytes, Option, Struct, Vector, str } from 'scale-ts';

export type UserSessionRepository = ReturnType<typeof createUserSessionRepository>;

export type StoredUserSession = CodecType<typeof storedUserSessionCodec>;

// V2 fields trail V1 fields so a future schema rev can append further
// `Option`-wrapped fields without breaking decode of 0.8.0 blobs.
const storedUserSessionCodec = Struct({
  id: str,
  localAccount: LocalSessionAccountCodec,
  remoteAccount: RemoteSessionAccountCodec,
  rootAccountId: AccountIdCodec,
  identityAccountId: Option(AccountIdCodec),
  identityChatPublicKey: Option(Bytes(65)),
});

type StoredUserSessionV2Extras = {
  identityAccountId?: AccountId;
  identityChatPublicKey?: Uint8Array;
};

export function createStoredUserSession(
  localAccount: LocalSessionAccount,
  remoteAccount: RemoteSessionAccount,
  rootAccountId: AccountId,
  extras: StoredUserSessionV2Extras = {},
): StoredUserSession {
  return {
    id: nanoid(12),
    localAccount,
    remoteAccount,
    rootAccountId,
    identityAccountId: extras.identityAccountId,
    identityChatPublicKey: extras.identityChatPublicKey,
  };
}

export const createUserSessionRepository = (storage: StorageAdapter) => {
  const codec = Vector(storedUserSessionCodec);

  return fieldListView<StoredUserSession>({
    storage,
    key: 'SsoSessions',
    from: x => {
      try {
        return codec.dec(fromHex(x));
      } catch {
        // 0.7.x V1 blobs use the prior codec shape and won't decode against
        // V2's extended struct. Treat as empty so the caller (and the
        // fieldListView mutate machinery) start clean; the next write
        // overwrites the bad blob.
        return [];
      }
    },
    to: x => toHex(codec.enc(x)),
  });
};
