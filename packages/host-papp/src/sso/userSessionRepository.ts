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

const storedUserSessionCodec = Struct({
  id: str,
  localAccount: LocalSessionAccountCodec,
  remoteAccount: RemoteSessionAccountCodec,
  rootAccountId: AccountIdCodec,
  identityAccountId: AccountIdCodec,
  identityChatPublicKey: Bytes(32),
  // `papp_encr_pub` (32-byte X25519). Persisted so the host can
  // rebuild its SSO session transport (`shared_secret_session =
  // ECDH(host_encr_secret, ssoEncPubKey)`) on a cold start without re-running
  // the handshake.
  ssoEncPubKey: Bytes(32),
  // RFC-0007 layer-1 `rootEntropySource` from the handshake; consumed by the
  // host's `host_derive_entropy` handler via `deriveProductEntropyFromSource`.
  rootEntropySource: Bytes(32),
  // Encryption public key of the authorising PApp device (32-byte X25519),
  // lifted from `HandshakeResponseV2.deviceEncPubKey`. Distinct from
  // `ssoEncPubKey` (the SSO session keypair) and from `remoteAccount.publicKey`
  // (the derived SSO shared secret): this is the peer device's long-lived ECDH
  // key, used by the host's device-sync channel to address the paired device.
  // Always present — `HandshakeResponseV2` carries it for every V2 pairing.
  deviceEncPubKey: Bytes(32),
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
    // V4: the encryption keys shrank from 65-byte P-256 to 32-byte X25519
    // (CHAT-RFC-0004). Fixed-size `Bytes` does not length-check on decode, so a
    // V3 blob would decode misaligned into a session that looks valid but
    // carries garbage keys — bump the key so old blobs are dropped instead.
    key: 'SsoSessionsV4',
    from: x => codec.dec(fromHex(x)),
    to: x => toHex(codec.enc(x)),
  });
};
