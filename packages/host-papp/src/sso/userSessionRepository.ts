import type { LocalSessionAccount, RemoteSessionAccount } from '@novasamatech/statement-store';
import { LocalSessionAccountCodec, RemoteSessionAccountCodec } from '@novasamatech/statement-store';
import type { StorageAdapter } from '@novasamatech/storage-adapter';
import { fieldListView } from '@novasamatech/storage-adapter';
import { nanoid } from 'nanoid';
import { fromHex, toHex } from 'polkadot-api/utils';
import { Struct, Vector, str } from 'scale-ts';

export type UserSessionRepository = ReturnType<typeof createUserSessionRepository>;

export type StoredUserSession = {
  id: string;
  localAccount: LocalSessionAccount;
  remoteAccount: RemoteSessionAccount;
};

const storedUserSessionCodec = Struct({
  id: str,
  localAccount: LocalSessionAccountCodec,
  remoteAccount: RemoteSessionAccountCodec,
});

export function createStoredUserSession(
  localAccount: LocalSessionAccount,
  remoteAccount: RemoteSessionAccount,
): StoredUserSession {
  return {
    id: nanoid(12),
    localAccount: localAccount,
    remoteAccount: remoteAccount,
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
