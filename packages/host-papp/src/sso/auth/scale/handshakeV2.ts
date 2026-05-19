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
 *                               Adressing for chat / username lookup / session
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
 *
 * Total wire length of `Success` is 32 + 32 + 32 + 65 = 161 bytes. Transit security
 * comes from the outer envelope's ECDH-AES wrap; no per-field signature is
 * carried — multi-device authorisation is asserted by the user-identity-signed
 * roster events (`DeviceAdded`/`DeviceRemoved`) published separately.
 */

import { p256 } from '@noble/curves/nist.js';
import { Bytes, Enum, Struct, Tuple, Vector, _void, str } from 'scale-ts';

const AccountIdCodec = Bytes(32);
const PublicKeyCodec = Bytes(65);
const PrivateKeyCodec = Bytes(32);

// ── Proposal ────────────────────────────────────────────────────────────

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

/**
 * V2 lives at SCALE discriminant 1; index 0 is reserved for legacy V1 which
 * neither side emits. The `_v1Reserved` slot pushes V2 to discriminant 1.
 */
export const VersionedHandshakeProposal = Enum({
  _v1Reserved: _void,
  V2: HandshakeProposalV2,
});

// ── Response (V2) ───────────────────────────────────────────────────────

/** 32 + 32 + 32 + 65 = 161 bytes (spec v0.2.1) */
export const HandshakeSuccessV2 = Struct({
  identityAccountId: AccountIdCodec,
  rootAccountId: AccountIdCodec,
  identityChatPrivateKey: PrivateKeyCodec,
  deviceEncPubKey: PublicKeyCodec,
});

export type HandshakeSuccessV2Value = {
  identityAccountId: Uint8Array;
  /** Nullable for v0.2 peers (Android `feature/location-for-handshake`). */
  rootAccountId: Uint8Array | null;
  identityChatPrivateKey: Uint8Array;
  deviceEncPubKey: Uint8Array;
};

/** 32 + 32 + 65 = 129 bytes (spec v0.2 — Android `feature/location-for-handshake`) */
export const HandshakeSuccessV2Legacy = Struct({
  identityAccountId: AccountIdCodec,
  identityChatPrivateKey: PrivateKeyCodec,
  deviceEncPubKey: PublicKeyCodec,
});

export type DecodedHandshakeResponseV2 =
  | { tag: 'Pending'; value: { tag: 'AllowanceAllocation'; value: undefined } }
  | { tag: 'Success'; value: HandshakeSuccessV2Value }
  | { tag: 'Failed'; value: string };

/**
 * Length-dispatched decoder for the inner `EncryptedHandshakeResponseV2`
 * plaintext. v0.2 (Android) ships 129-byte Success bodies without
 * `rootAccountId`; v0.2.1 ships 161-byte bodies with it. Surfaces
 * `rootAccountId: null` for the legacy case — chat doesn't need it.
 */
export const decodeEncryptedHandshakeResponseV2 = (bytes: Uint8Array): DecodedHandshakeResponseV2 => {
  if (bytes.length === 0) throw new Error('EncryptedHandshakeResponseV2: empty plaintext');
  const tag = bytes[0];
  // `slice` not `subarray` — scale-ts decoders read from buffer byteOffset 0.
  const body = bytes.slice(1);
  if (tag === 0) {
    if (body.length === 0) throw new Error('EncryptedHandshakeResponseV2: Pending body empty');
    return { tag: 'Pending', value: { tag: 'AllowanceAllocation', value: undefined } };
  }
  if (tag === 1) {
    if (body.length === 161) {
      const decoded = HandshakeSuccessV2.dec(body);
      return {
        tag: 'Success',
        value: {
          identityAccountId: decoded.identityAccountId,
          rootAccountId: decoded.rootAccountId,
          identityChatPrivateKey: decoded.identityChatPrivateKey,
          deviceEncPubKey: decoded.deviceEncPubKey,
        },
      };
    }
    if (body.length === 129) {
      const decoded = HandshakeSuccessV2Legacy.dec(body);
      return {
        tag: 'Success',
        value: {
          identityAccountId: decoded.identityAccountId,
          rootAccountId: null,
          identityChatPrivateKey: decoded.identityChatPrivateKey,
          deviceEncPubKey: decoded.deviceEncPubKey,
        },
      };
    }
    throw new Error(`EncryptedHandshakeResponseV2: Success body length ${body.length} not in {129, 161}`);
  }
  if (tag === 2) {
    return { tag: 'Failed', value: str.dec(body) };
  }
  throw new Error(`EncryptedHandshakeResponseV2: unknown variant tag ${tag}`);
};

/**
 * Derive the user identity chat P-256 public key from the shared private
 * scalar received in `HandshakeSuccessV2`. Both desktop and mobile must derive
 * identically (uncompressed 65-byte form) so downstream session topics agree.
 */
export const deriveIdentityChatPublicKey = (privateKey: Uint8Array): Uint8Array => p256.getPublicKey(privateKey, false);

/**
 * Inner Pending sub-statuses. Only `AllowanceAllocation` today.
 *
 * Encoded with its own SCALE discriminant byte — the peer's SCALE library does
 * NOT elide enum-variant indices for sealed interfaces (verified on the wire:
 * `Pending(AllowanceAllocation)` arrives as `0x00 0x00`). Both sides must keep
 * the discriminant when encoding so dispatch agrees.
 */
export const HandshakeStatusV2 = Enum({
  AllowanceAllocation: _void,
});

export type EncryptedHandshakeResponseV2Value =
  | { tag: 'Pending'; value: { tag: 'AllowanceAllocation'; value: undefined } }
  | { tag: 'Success'; value: HandshakeSuccessV2Value }
  | { tag: 'Failed'; value: string };

/**
 * Inner handshake response variant. Wire shape (matches peer SCALE encoding):
 *
 *   - Pending → 0x00 || HandshakeStatusV2 (today: 0x00 for AllowanceAllocation), 2 bytes total
 *   - Success → 0x01 || HandshakeSuccessV2 (161 bytes), 162 bytes total
 *   - Failed  → 0x02 || SCALE-encoded UTF-8 reason string
 *
 * Earlier builds shipped a custom length-dispatched codec assuming elision —
 * that assumption was wrong and produced false `Failed("")` reads on every
 * `Pending` response. Native scale-ts `Enum` preserves the discriminant and
 * matches the peer's wire format directly.
 */
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
