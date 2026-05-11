import type { AccountId, LocalSessionAccount, RemoteSessionAccount } from '@novasamatech/statement-store';
import { AccountIdCodec, LocalSessionAccountCodec, RemoteSessionAccountCodec } from '@novasamatech/statement-store';
import type { StorageAdapter } from '@novasamatech/storage-adapter';
import { fieldListView } from '@novasamatech/storage-adapter';
import { nanoid } from 'nanoid';
import { fromHex, toHex } from 'polkadot-api/utils';
import type { CodecType } from 'scale-ts';
import { Struct, Vector, str } from 'scale-ts';

export type UserSessionRepository = ReturnType<typeof createUserSessionRepository>;

export type StoredUserSession = CodecType<typeof storedUserSessionCodec>;

const storedUserSessionCodec = Struct({
  id: str,
  localAccount: LocalSessionAccountCodec,
  remoteAccount: RemoteSessionAccountCodec,
  rootAccountId: AccountIdCodec,
});

export function createStoredUserSession(
  localAccount: LocalSessionAccount,
  remoteAccount: RemoteSessionAccount,
  rootAccountId: AccountId,
): StoredUserSession {
  return {
    id: nanoid(12),
    localAccount: localAccount,
    remoteAccount: remoteAccount,
    rootAccountId,
  };
}

export const createUserSessionRepository = (storage: StorageAdapter) => {
  const codec = Vector(storedUserSessionCodec);

  return fieldListView<StoredUserSession>({
    storage,
    key: 'SsoSessions',
    from: x => codec.dec(fromHex(x)),
    to: x => toHex(codec.enc(x)),
  });
};
