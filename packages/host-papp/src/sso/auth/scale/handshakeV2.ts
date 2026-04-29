/**
 * SCALE codecs for the V2 SSO handshake.
 *
 * The host emits a `VersionedHandshakeProposal::V2` via QR carrying its
 * `Device { statementAccountId, encryptionPublicKey }` and metadata. The
 * authorising peer responds over the Statement Store with a
 * `VersionedHandshakeResponse`; its body is ECDH-encrypted to the host's
 * encryption public key with the peer's ephemeral `tmpKey`. The inner
 * payload after decrypt is `EncryptedHandshakeResponseV2 = Pending | Success
 * | Failed`.
 *
 * `Success` carries the user identity chat encryption pubkey, the user
 * identity sr25519 accountId, and a 64-byte sr25519 signature over
 * `statementAccountId || encryptionPublicKey` (97 bytes — see
 * `IDENTITY_SIGNATURE_PAYLOAD_BYTES`) proving the user authorised this device.
 */

import type { Codec } from 'scale-ts';
import { Bytes, Enum, Struct, Tuple, Vector, _void, createCodec, str } from 'scale-ts';

const AccountIdCodec = Bytes(32);
const PublicKeyCodec = Bytes(65);
const SignatureCodec = Bytes(64);

/** Bytes the user identity sr25519 signs to authorise a device: accountId(32) || encPub(65). */
export const IDENTITY_SIGNATURE_PAYLOAD_BYTES = 32 + 65;

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

export const HandshakeSuccessV2 = Struct({
  encryptionKey: PublicKeyCodec,
  accountId: AccountIdCodec,
  identitySignature: SignatureCodec,
});

/**
 * Inner Pending sub-statuses; only `AllowanceAllocation` today. Kept for
 * schema symmetry — not actually encoded on the wire because the peer
 * encodes `data object AllowanceAllocation` as zero bytes, so the entire
 * Pending statement is just the outer discriminant `0x00`.
 */
export const HandshakeStatusV2 = Enum({
  AllowanceAllocation: _void,
});

const SUCCESS_LEN = 65 + 32 + 64;
const PENDING_BYTE = 0x00;

export type EncryptedHandshakeResponseV2Value =
  | { tag: 'Pending'; value: undefined }
  | {
      tag: 'Success';
      value: { encryptionKey: Uint8Array; accountId: Uint8Array; identitySignature: Uint8Array };
    }
  | { tag: 'Failed'; value: string };

const toBytes = (value: Uint8Array | ArrayBuffer | string): Uint8Array => {
  if (typeof value === 'string') {
    const hex = value.startsWith('0x') ? value.slice(2) : value;
    const out = new Uint8Array(hex.length / 2);
    for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    return out;
  }
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  return value;
};

/**
 * Length-dispatched variant codec. The peer's SCALE library elides the outer
 * enum index for class-wrapped sealed-interface variants, leaving each
 * variant's bytes exposed directly:
 *
 *   - Pending → 1 byte:    0x00 (the inner `AllowanceAllocation` tag; the
 *                          outer Pending wrapper emits nothing)
 *   - Success → 161 bytes: HandshakeSuccessV2 fields concatenated
 *                          (encryptionKey 65 || accountId 32 || signature 64)
 *   - Failed  → variable:  SCALE-encoded UTF-8 reason string
 *
 * Disambiguation is purely by byte length; protocol-state context further
 * constrains which variant is plausible at any given moment.
 */
export const EncryptedHandshakeResponseV2: Codec<EncryptedHandshakeResponseV2Value> = createCodec(
  v => {
    switch (v.tag) {
      case 'Pending':
        return new Uint8Array([PENDING_BYTE]);
      case 'Success':
        return HandshakeSuccessV2.enc(v.value);
      case 'Failed':
        return str.enc(v.value);
    }
  },
  raw => {
    const bytes = toBytes(raw);
    if (bytes.length === 1 && bytes[0] === PENDING_BYTE) {
      return { tag: 'Pending', value: undefined };
    }
    if (bytes.length === SUCCESS_LEN) {
      return { tag: 'Success', value: HandshakeSuccessV2.dec(bytes) };
    }
    return { tag: 'Failed', value: str.dec(bytes) };
  },
);

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
