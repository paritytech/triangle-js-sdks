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

// scale-ts has no notion of optional trailing fields: decoding a blob that
// ends before a struct's last field throws ("offset outside bounds"), so a
// schema rev that appends a field cannot read back blobs written without it.
// There is deliberately no in-codec back-compat — a blob from before a field
// was added requires the host to reset app data / re-pair. Append new fields
// at the tail (never insert) so the layout stays append-only.
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
  // Encryption public key of the authorising PApp device (65-byte uncompressed
  // P-256), lifted from `HandshakeResponseV2.deviceEncPubKey`. Distinct from
  // `ssoEncPubKey` (the SSO session keypair) and from `remoteAccount.publicKey`
  // (the derived SSO shared secret): this is the peer device's long-lived ECDH
  // key, used by the host's device-sync channel to address the paired device.
  // Always present — `HandshakeResponseV2` carries it for every V2 pairing.
  deviceEncPubKey: Bytes(65),
});

type StoredUserSessionV2Extras = {
  identityAccountId: AccountId;
  identityChatPublicKey: Uint8Array;
  ssoEncPubKey: Uint8Array;
  rootEntropySource: Uint8Array;
  deviceEncPubKey: Uint8Array;
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
    deviceEncPubKey: extras.deviceEncPubKey,
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
