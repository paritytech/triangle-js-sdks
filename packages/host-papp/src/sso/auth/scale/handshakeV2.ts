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
 *   - `ssoEncPubKey`          — `papp_encr_pub` (65 bytes, P-256 uncompressed); see
 *                               the `HandshakeSuccessV2` codec doc below.
 *   - `rootEntropySource`     — 32 bytes; `blake2b256_keyed(rootAccountSecret,
 *                               "product-entropy-derivation")` per RFC-0007 (layer 1).
 *                               Lets the host derive product entropy deterministically
 *                               (`host_derive_entropy`) without ever holding the raw
 *                               root account secret. See the codec doc below.
 *
 * Total wire length of `Success` is 32 + 32 + 32 + 65 + 65 + 32 = 258 bytes. Transit
 * security comes from the outer envelope's ECDH-AES wrap; no per-field signature is
 * carried — multi-device authorisation is asserted by the user-identity-signed
 * roster events (`DeviceAdded`/`DeviceRemoved`) published separately.
 */

import { p256 } from '@noble/curves/nist.js';
import { Bytes, Enum, Struct, Tuple, Vector, _void, str } from 'scale-ts';

const AccountIdCodec = Bytes(32);
const PublicKeyCodec = Bytes(65);
const PrivateKeyCodec = Bytes(32);
const EntropySourceCodec = Bytes(32);

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

/**
 * 32 + 32 + 32 + 65 + 65 + 32 = 258 bytes. Appends `rootEntropySource` to the
 * v0.2.2 body; this revision is not yet pinned in the Mobile SSO spec (latest
 * defined there is v0.2.2 — the 226-byte `HandshakeSuccessV2_v022` below).
 *
 * `ssoEncPubKey` is `papp_encr_pub` per spec § Encrypted response — V2 — the
 * P-256 public key PApp uses for SSO session ECDH. Required to compute
 * `shared_secret_session = ECDH(host_encr_secret, ssoEncPubKey)`. PApp keypair
 * derivation is implementation-defined: Android derives under `//wallet//sso`
 * (`SsoDerivationDomains.SSO_DERIVATION_DOMAIN`); iOS currently reuses
 * `//wallet//chat`. The host treats this field as opaque public material —
 * which keypair PApp picked is invisible here.
 *
 * `rootEntropySource` is `blake2b256_keyed(rootAccountSecret,
 * "product-entropy-derivation")` — layer 1 of the RFC-0007 derivation. PApp
 * computes it from the root account secret and shares it here so the host can
 * derive product entropy (`host_derive_entropy`) via
 * `deriveProductEntropyFromSource` without ever holding the raw secret. Every
 * conforming host derives identical entropy from it.
 */
export const HandshakeSuccessV2 = Struct({
  identityAccountId: AccountIdCodec,
  rootAccountId: AccountIdCodec,
  identityChatPrivateKey: PrivateKeyCodec,
  ssoEncPubKey: PublicKeyCodec,
  deviceEncPubKey: PublicKeyCodec,
  rootEntropySource: EntropySourceCodec,
});

export type HandshakeSuccessV2Value = {
  identityAccountId: Uint8Array;
  /** Nullable for v0.2 peers (Android `feature/location-for-handshake`). */
  rootAccountId: Uint8Array | null;
  identityChatPrivateKey: Uint8Array;
  /**
   * Nullable for v0.2 / v0.2.1 peers (any PApp build that does not yet ship
   * spec v0.2.2). The host's SSO session transport stays inactive while
   * null — sign/vrf/etc operations fail at the boundary until PApp emits
   * the new field.
   */
  ssoEncPubKey: Uint8Array | null;
  deviceEncPubKey: Uint8Array;
  /**
   * RFC-0007 layer-1 `rootEntropySource`. Null for peers that don't send it
   * (everything up to and including spec v0.2.2); while null the host cannot
   * serve `host_derive_entropy` and must surface an error rather than fall back
   * to a non-deterministic secret.
   */
  rootEntropySource: Uint8Array | null;
};

/** 32 + 32 + 32 + 65 + 65 = 226 bytes (spec v0.2.2 — `rootEntropySource` absent). */
export const HandshakeSuccessV2_v022 = Struct({
  identityAccountId: AccountIdCodec,
  rootAccountId: AccountIdCodec,
  identityChatPrivateKey: PrivateKeyCodec,
  ssoEncPubKey: PublicKeyCodec,
  deviceEncPubKey: PublicKeyCodec,
});

/** 32 + 32 + 32 + 65 = 161 bytes (spec v0.2.1) */
export const HandshakeSuccessV2_v021 = Struct({
  identityAccountId: AccountIdCodec,
  rootAccountId: AccountIdCodec,
  identityChatPrivateKey: PrivateKeyCodec,
  deviceEncPubKey: PublicKeyCodec,
});

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
 * plaintext. Four Success body shapes are accepted, one per spec rev:
 *
 *   258 bytes — includes `rootEntropySource` (RFC-0007 layer 1); not yet a named spec rev.
 *   226 bytes (spec v0.2.2) — `rootEntropySource` absent; surfaced as `null`.
 *   161 bytes (spec v0.2.1) — `ssoEncPubKey` absent; surfaced as `null`.
 *   129 bytes (spec v0.2)   — `rootAccountId` AND `ssoEncPubKey` absent.
 *
 * Older peers degrade gracefully: chat continues to work via
 * `identityChatPrivateKey`, but the SSO session transport (which needs
 * `ssoEncPubKey` to derive `shared_secret_session`) and `host_derive_entropy`
 * (which needs `rootEntropySource`) stay inactive on the host until the peer
 * upgrades.
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
    if (body.length === 258) {
      const decoded = HandshakeSuccessV2.dec(body);
      return {
        tag: 'Success',
        value: {
          identityAccountId: decoded.identityAccountId,
          rootAccountId: decoded.rootAccountId,
          identityChatPrivateKey: decoded.identityChatPrivateKey,
          ssoEncPubKey: decoded.ssoEncPubKey,
          deviceEncPubKey: decoded.deviceEncPubKey,
          rootEntropySource: decoded.rootEntropySource,
        },
      };
    }
    if (body.length === 226) {
      const decoded = HandshakeSuccessV2_v022.dec(body);
      return {
        tag: 'Success',
        value: {
          identityAccountId: decoded.identityAccountId,
          rootAccountId: decoded.rootAccountId,
          identityChatPrivateKey: decoded.identityChatPrivateKey,
          ssoEncPubKey: decoded.ssoEncPubKey,
          deviceEncPubKey: decoded.deviceEncPubKey,
          rootEntropySource: null,
        },
      };
    }
    if (body.length === 161) {
      const decoded = HandshakeSuccessV2_v021.dec(body);
      return {
        tag: 'Success',
        value: {
          identityAccountId: decoded.identityAccountId,
          rootAccountId: decoded.rootAccountId,
          identityChatPrivateKey: decoded.identityChatPrivateKey,
          ssoEncPubKey: null,
          deviceEncPubKey: decoded.deviceEncPubKey,
          rootEntropySource: null,
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
          ssoEncPubKey: null,
          deviceEncPubKey: decoded.deviceEncPubKey,
          rootEntropySource: null,
        },
      };
    }
    throw new Error(`EncryptedHandshakeResponseV2: Success body length ${body.length} not in {129, 161, 226, 258}`);
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
 *   - Success → 0x01 || HandshakeSuccessV2 (258 bytes with rootEntropySource), 259 bytes total
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
