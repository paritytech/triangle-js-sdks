import type { AccountId, LocalSessionAccount, RemoteSessionAccount } from '@novasamatech/statement-store';
import { AccountIdCodec, LocalSessionAccountCodec, RemoteSessionAccountCodec } from '@novasamatech/statement-store';
import type { StorageAdapter } from '@novasamatech/storage-adapter';
import { fieldListView } from '@novasamatech/storage-adapter';
import { nanoid } from 'nanoid';
import { fromHex, toHex } from 'polkadot-api/utils';
import type { CodecType } from 'scale-ts';
import { Bytes, Struct, Vector, str } from 'scale-ts';

export type UserSessionRepository = ReturnType<typeof createUserSessionRepository>;

export type StoredUserSession = CodecType<typeof storedUserSessionCodec>;

// V2 fields trail V1 fields so a future schema rev can append further
// `Option`-wrapped fields without breaking decode of 0.8.0 blobs.
const storedUserSessionCodec = Struct({
  id: str,
  localAccount: LocalSessionAccountCodec,
  remoteAccount: RemoteSessionAccountCodec,
  rootAccountId: AccountIdCodec,
  identityAccountId: AccountIdCodec,
  identityChatPublicKey: Bytes(65),
  // `papp_encr_pub` (65-byte uncompressed P-256). Persisted so the host can
  // rebuild its SSO session transport (`shared_secret_session =
  // ECDH(host_encr_secret, ssoEncPubKey)`) on a cold start without re-running
  // the handshake.
  ssoEncPubKey: Bytes(65),
  // RFC-0007 layer-1 `rootEntropySource` from the handshake; consumed by the
  // host's `host_derive_entropy` handler via `deriveProductEntropyFromSource`.
  rootEntropySource: Bytes(32),
});

type StoredUserSessionV2Extras = {
  identityAccountId: AccountId;
  identityChatPublicKey: Uint8Array;
  ssoEncPubKey: Uint8Array;
  rootEntropySource: Uint8Array;
};

export function createStoredUserSession(
  localAccount: LocalSessionAccount,
  remoteAccount: RemoteSessionAccount,
  rootAccountId: AccountId,
  extras: StoredUserSessionV2Extras,
): StoredUserSession {
  return {
    id: nanoid(12),
    localAccount,
    remoteAccount,
    rootAccountId,
    identityAccountId: extras.identityAccountId,
    identityChatPublicKey: extras.identityChatPublicKey,
    ssoEncPubKey: extras.ssoEncPubKey,
    rootEntropySource: extras.rootEntropySource,
  };
}

export const createUserSessionRepository = (storage: StorageAdapter) => {
  const codec = Vector(storedUserSessionCodec);

  return fieldListView<StoredUserSession>({
    storage,
    key: 'SsoSessionsV2',
    from: x => codec.dec(fromHex(x)),
    to: x => toHex(codec.enc(x)),
  });
};
