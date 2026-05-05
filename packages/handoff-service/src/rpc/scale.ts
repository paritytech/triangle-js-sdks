import { Bytes, Enum } from 'scale-ts';

/**
 * SCALE-encoded MultiSigner:
 *   0 = Ed25519 (32 bytes)
 *   1 = SR25519 (32 bytes)
 *   2 = ECDSA   (33 bytes)
 */
export const MultiSigner = Enum({
  ed25519: Bytes(32),
  sr25519: Bytes(32),
  ecdsa: Bytes(33),
});

/**
 * SCALE-encoded MultiSignature:
 *   0 = Ed25519 (64 bytes)
 *   1 = SR25519 (64 bytes)
 *   2 = ECDSA   (65 bytes)
 */
export const MultiSignature = Enum({
  ed25519: Bytes(64),
  sr25519: Bytes(64),
  ecdsa: Bytes(65),
});
