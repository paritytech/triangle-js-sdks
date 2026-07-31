/**
 * Multi-device statement envelope (mds.md §"Sending P2P Messages").
 *
 * A fresh 32-byte one-shot key encrypts the inner `Request`/`Response`; that key is then
 * wrapped once per recipient device via X25519 key agreement between the sender's device
 * encryption key and the recipient device's encryption public key:
 *
 *   encryptedPayload = aead(oneShotKey, inner)                      // key used RAW, no KDF
 *   devicesInfo[i]   = { statementAccountId, encryptedKey }
 *   encryptedKey     = encryption(x25519(ownEncPriv, deviceEncPub)).encrypt(oneShotKey)
 *
 * The one-shot key is already uniformly random, so it is used directly as the AEAD key —
 * unlike {@link createEncryption}, which HKDFs its input because that input is a raw ECDH
 * shared secret. This split matches Android (`MultiDeviceEnvelopeEncryption`) byte for byte.
 *
 * Three read paths:
 *  - {@link Envelope.unwrapForOwnDevice} — a peer's envelope addressed to us.
 *  - {@link Envelope.unwrapOwn} — OUR OWN envelope, read back from the store. The wrap
 *    secret is symmetric, so we re-derive it against any recipient device we wrapped for.
 *    This is what lets the statement store hold the outgoing-request state through a
 *    restart (base-spec.md §"Session Initialization Phase") instead of a client-side outbox.
 *  - single-device sessions pass no envelope at all; tags 2/3 then decode as `undecodable`.
 */

import { chacha20poly1305 } from '@noble/ciphers/chacha.js';
import { x25519 } from '@noble/curves/ed25519.js';
import { randomBytes } from '@noble/hashes/utils.js';
import { Result, err, fromThrowable } from 'neverthrow';
import { mergeUint8 } from 'polkadot-api/utils';
import type { CodecType } from 'scale-ts';

import { toError } from '../../helpers.js';
import type { Encryption } from '../encyption.js';
import { createEncryption } from '../encyption.js';
import type { RequestDeviceInfo } from '../scale/statementData.js';

/** One-shot symmetric key length. Mirrors Android's `MessageEncryption` (32 bytes). */
const ONE_SHOT_KEY_BYTES = 32;
/** AEAD nonce length. Same 12 bytes for AES-GCM and ChaCha20-Poly1305. */
const AEAD_NONCE_BYTES = 12;

export type DeviceTarget = {
  /** 32-byte sr25519 statement account id — the device's identifier on the wire. */
  statementAccountId: Uint8Array;
  /** 32-byte X25519 device encryption public key. */
  encryptionPublicKey: Uint8Array;
};

const ACCOUNT_ID_BYTES = 32;
const PUBLIC_KEY_BYTES = 32;

/**
 * Both fields are fixed-width on the wire, and `Bytes(32)` zero-pads anything shorter — a
 * malformed roster entry would otherwise yield a valid-looking statement addressed to the
 * wrong device, or a topic no peer ever writes to, with no error anywhere.
 */
export function isValidDevice(device: DeviceTarget): boolean {
  return (
    device.statementAccountId.length === ACCOUNT_ID_BYTES && device.encryptionPublicKey.length === PUBLIC_KEY_BYTES
  );
}

type DeviceEntry = CodecType<typeof RequestDeviceInfo>;

type WrappedEnvelope = {
  encryptedPayload: Uint8Array;
  devicesInfo: DeviceEntry[];
};

export type Envelope = {
  wrap(plaintext: Uint8Array, recipients: DeviceTarget[]): Result<WrappedEnvelope, Error>;
  /** Decrypt an envelope a peer addressed to this device. */
  unwrapForOwnDevice(
    encryptedPayload: Uint8Array,
    devicesInfo: DeviceEntry[],
    senderEncryptionPublicKey: Uint8Array,
  ): Result<Uint8Array, Error>;
  /** Decrypt an envelope WE produced, using any recipient device we wrapped it for. */
  unwrapOwn(
    encryptedPayload: Uint8Array,
    devicesInfo: DeviceEntry[],
    peerDevices: DeviceTarget[],
  ): Result<Uint8Array, Error>;
};

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }

  return true;
}

// The one-shot key is uniformly random already, so it keys the AEAD directly.
const aeadEncrypt = fromThrowable((key: Uint8Array, plaintext: Uint8Array) => {
  const nonce = randomBytes(AEAD_NONCE_BYTES);

  return mergeUint8([nonce, chacha20poly1305(key, nonce).encrypt(plaintext)]);
}, toError);

const aeadDecrypt = fromThrowable((key: Uint8Array, encrypted: Uint8Array) => {
  const nonce = encrypted.slice(0, AEAD_NONCE_BYTES);
  const cipherText = encrypted.slice(AEAD_NONCE_BYTES);

  return chacha20poly1305(key, nonce).decrypt(cipherText);
}, toError);

/**
 * `@noble` aborts on an all-zero (small-order) X25519 result per RFC 7748, so a hostile
 * device key fails loudly here rather than yielding a predictable key (RFC-0004 §1).
 */
const deviceEncryption = fromThrowable(
  (ownEncryptionPrivateKey: Uint8Array, peerEncryptionPublicKey: Uint8Array): Encryption =>
    createEncryption(x25519.getSharedSecret(ownEncryptionPrivateKey, peerEncryptionPublicKey)),
  toError,
);

export function createEnvelope({
  ownStatementAccountId,
  ownEncryptionPrivateKey,
}: {
  ownStatementAccountId: Uint8Array;
  ownEncryptionPrivateKey: Uint8Array;
}): Envelope {
  // Unwrapping a key against a given peer device pubkey — the same derivation the wrap
  // side uses, which is why `unwrapOwn` works at all.
  function unwrapKeyAgainst(peerEncryptionPublicKey: Uint8Array, encryptedKey: Uint8Array) {
    return deviceEncryption(ownEncryptionPrivateKey, peerEncryptionPublicKey).andThen(encryption =>
      encryption.decrypt(encryptedKey),
    );
  }

  return {
    wrap(plaintext, recipients) {
      if (recipients.length === 0) {
        return err(new Error('envelope: cannot wrap without recipient devices'));
      }

      const malformed = recipients.find(recipient => !isValidDevice(recipient));
      if (malformed) {
        return err(
          new Error(
            `envelope: recipient device is malformed (statementAccountId ${malformed.statementAccountId.length.toString()} bytes, encryptionPublicKey ${malformed.encryptionPublicKey.length.toString()} bytes; both must be 32)`,
          ),
        );
      }

      const oneShotKey = randomBytes(ONE_SHOT_KEY_BYTES);

      return Result.combine(
        recipients.map(recipient =>
          deviceEncryption(ownEncryptionPrivateKey, recipient.encryptionPublicKey)
            .andThen(encryption => encryption.encrypt(oneShotKey))
            .map<DeviceEntry>(encryptedKey => ({
              statementAccountId: recipient.statementAccountId,
              encryptedKey,
            })),
        ),
      ).andThen(devicesInfo =>
        aeadEncrypt(oneShotKey, plaintext).map(encryptedPayload => ({ encryptedPayload, devicesInfo })),
      );
    },

    unwrapForOwnDevice(encryptedPayload, devicesInfo, senderEncryptionPublicKey) {
      const ownEntry = devicesInfo.find(entry => bytesEqual(entry.statementAccountId, ownStatementAccountId));
      if (!ownEntry) {
        return err(new Error('envelope: no entry addressed to this device'));
      }

      return unwrapKeyAgainst(senderEncryptionPublicKey, ownEntry.encryptedKey).andThen(oneShotKey =>
        aeadDecrypt(oneShotKey, encryptedPayload),
      );
    },

    unwrapOwn(encryptedPayload, devicesInfo, peerDevices) {
      // Any recipient entry works: we wrapped every one of them with our own private key,
      // so re-deriving x25519(ownPriv, thatDevicePub) reproduces the wrap secret exactly.
      for (const device of peerDevices) {
        const entry = devicesInfo.find(candidate =>
          bytesEqual(candidate.statementAccountId, device.statementAccountId),
        );
        if (!entry) continue;

        const unwrapped = unwrapKeyAgainst(device.encryptionPublicKey, entry.encryptedKey).andThen(oneShotKey =>
          aeadDecrypt(oneShotKey, encryptedPayload),
        );
        // A stale roster entry can fail to unwrap while a newer one still succeeds, so
        // keep trying the remaining devices rather than failing on the first mismatch.
        if (unwrapped.isOk()) return unwrapped;
      }

      return err(new Error('envelope: no known peer device entry to unwrap own payload'));
    },
  };
}
