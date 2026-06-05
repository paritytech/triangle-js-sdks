/**
 * SCALE codecs for the V2 SSO handshake (multi-device shape).
 *
 * The host emits a `VersionedHandshakeProposal::V2` via QR carrying its
 * `Device { statementAccountId, encryptionPublicKey }` and metadata. The
 * authorising peer (PApp) responds over the Statement Store with a
 * `VersionedHandshakeResponse`; its body is ECDH-encrypted to the host's
 * encryption public key with the peer's ephemeral `tmpKey`. The inner payload
 * after decrypt is `EncryptedHandshakeResponseV2 = Pending | Success | Failed`.
 *
 * `Success` carries:
 *   - `identityAccountId`     — user identity sr25519 accountId (32 bytes).
 *                               Addressing for chat / username lookup / session
 *                               topic derivation.
 *   - `rootAccountId`         — user root sr25519 accountId (32 bytes). Parent
 *                               for soft-derivation of product accounts; PApp
 *                               and host MUST derive identically so a dapp sees
 *                               the same address on every device.
 *   - `identityChatPrivateKey`— user identity chat P-256 private scalar (32 bytes),
 *                               shared per the multi-device spec so this device
 *                               can decrypt traffic addressed to the user identity
 *   - `deviceEncPubKey`       — encryption public key of the PApp device (65 bytes,
 *                               P-256 uncompressed). Tells the host which key to
 *                               use when addressing chat envelopes back to the
 *                               authorising PApp device.
 *   - `ssoEncPubKey`          — `papp_encr_pub` (65 bytes, P-256 uncompressed); see
 *                               the `HandshakeSuccessV2` codec doc below.
 *   - `rootEntropySource`     — 32 bytes; `blake2b256_keyed(rootAccountSecret,
 *                               "product-entropy-derivation")` per RFC-0007 (layer 1).
 *                               Lets the host derive product entropy deterministically
 *                               (`host_derive_entropy`) without ever holding the raw
 *                               root account secret. See the codec doc below.
 */

import { p256 } from '@noble/curves/nist.js';
import { Bytes, Enum, Struct, Tuple, Vector, _void, str } from 'scale-ts';

const AccountIdCodec = Bytes(32);
const PublicKeyCodec = Bytes(65);
const PrivateKeyCodec = Bytes(32);
const EntropySourceCodec = Bytes(32);

export const MetadataKey = Enum({
  Custom: str,
  HostName: _void,
  HostVersion: _void,
  HostIcon: _void,
  PlatformType: _void,
  PlatformVersion: _void,
});

export const MetadataEntry = Tuple(MetadataKey, str);

export const Device = Struct({
  statementAccountId: AccountIdCodec,
  encryptionPublicKey: PublicKeyCodec,
});

export const HandshakeProposalV2 = Struct({
  device: Device,
  metadata: Vector(MetadataEntry),
});

export const VersionedHandshakeProposal = Enum({
  _v1Reserved: _void,
  V2: HandshakeProposalV2,
});

// V2 Response

export const HandshakeSuccessV2 = Struct({
  identityAccountId: AccountIdCodec,
  rootAccountId: AccountIdCodec,
  identityChatPrivateKey: PrivateKeyCodec,
  /** PApp's P-256 SSO ECDH public key (`papp_encr_pub`). */
  ssoEncPubKey: PublicKeyCodec,
  deviceEncPubKey: PublicKeyCodec,
  /** Layer-1 source for deterministic product entropy derivation (RFC-0007). */
  rootEntropySource: EntropySourceCodec,
});

/** Derive the identity chat P-256 public key (uncompressed) from its private scalar. */
export const deriveIdentityChatPublicKey = (privateKey: Uint8Array): Uint8Array => p256.getPublicKey(privateKey, false);

export const HandshakeStatusV2 = Enum({
  AllowanceAllocation: _void,
});

/** Inner handshake response variant. */
export const EncryptedHandshakeResponseV2 = Enum({
  Pending: HandshakeStatusV2,
  Success: HandshakeSuccessV2,
  Failed: str,
});

export const HandshakeResponseV2 = Struct({
  encrypted: Bytes(),
  tmpKey: PublicKeyCodec,
});

/** Legacy V1 response shape — decoded for backward compat, never emitted by the V2 path. */
export const HandshakeResponseV1 = Struct({
  encrypted: Bytes(),
  tmpKey: PublicKeyCodec,
});

export const EncryptedHandshakeResponseV1 = Struct({
  encryptionKey: PublicKeyCodec,
  accountId: AccountIdCodec,
});

export const VersionedHandshakeResponse = Enum({
  V1: HandshakeResponseV1,
  V2: HandshakeResponseV2,
});
