import { Bytes, Enum } from '@novasamatech/scale';
import { Struct } from 'scale-ts';

/**
 * `Resources.Consumers.identifier_key` — a peer's chat encryption key as the chain
 * records it (CHAT-RFC-0004 §4).
 *
 * The 65-byte width predates X25519: it is what an uncompressed P-256 point occupied,
 * and it stayed when the curve changed. Only the keypair type and the key width moved
 * (0x04 + 64 → 0x00 + 32), so the field is still `SizedHex<65>` in runtime metadata.
 *
 * Padding is carried as a field because the RFC requires readers to ignore it rather
 * than validate it. Decoding throws on a keypair type this SDK does not implement;
 * `decodeRawIdentity` maps that to `null`.
 */
export const IdentifierKey = Enum({
  X25519: Struct({ key: Bytes(32), padding: Bytes(32) }),
});
