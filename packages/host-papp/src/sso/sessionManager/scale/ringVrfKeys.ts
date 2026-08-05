import {
  DerivationIndex,
  DotNsIdentifier,
  ListRingVrfKeysErr,
  RegisterRingVrfKeyErr,
  RegisteredRingVrfKey,
  RingLocation,
  RingVrfKeyDisclosure,
  RingVrfPublicKey,
} from '@novasamatech/host-api';
import type { CodecType } from 'scale-ts';
import { Result, Struct, Vector, str } from 'scale-ts';

// RFC-0024 ring VRF key registry. The Account Holder is the authoritative
// registry — it needs the complete set to serve slot assignment and PGAS claims,
// and to show the user what their keys are used for. The Host holds a
// synchronized copy and answers `list` from it when the snapshot is current.

/**
 * Host → Account Holder registration of a key the calling product owns.
 *
 * Ownership is `callingProductId` and is never chosen by the caller, so this is
 * consent-free. Registration is idempotent: re-registering an `index` for an
 * additional `ring` extends the existing entry rather than creating a second
 * one, so re-notifying the phone about an entry it already has costs nothing.
 *
 * A Host holding the product's ring VRF domain entropy (see `AutoSigning` in
 * `resourceAllocation.ts`) answers immediately and mirrors this fire-and-forget;
 * without the entropy it issues the request and waits.
 *
 * > A Host MUST NOT derive a member secret for a `(product, index)` pair absent
 * > from its registry. Domain entropy makes derivation unconditional — only
 * > registration, which always reaches the phone, brings a key into existence.
 */
export type RegisterRingVrfKeyRequest = CodecType<typeof RegisterRingVrfKeyRequestCodec>;
export const RegisterRingVrfKeyRequestCodec = Struct({
  callingProductId: DotNsIdentifier,
  index: DerivationIndex,
  ring: RingLocation,
});

export type RegisterRingVrfKeyResponse = CodecType<typeof RegisterRingVrfKeyResponseCodec>;
export const RegisterRingVrfKeyResponseCodec = Struct({
  // referencing to RemoteMessage.messageId
  respondingTo: str,
  payload: Result(RingVrfPublicKey, RegisterRingVrfKeyErr),
});

/**
 * Host → Account Holder listing of the registry entries owned by `owner`.
 *
 * `owner` may be `callingProductId` — permissionless — or another product, in
 * which case the caller needs a grant. `PublicKey` disclosure additionally
 * returns the member public key, which is linkable across every ring it appears
 * in and so is permissioned cross-product even though the handle is not.
 */
export type ListRingVrfKeysRequest = CodecType<typeof ListRingVrfKeysRequestCodec>;
export const ListRingVrfKeysRequestCodec = Struct({
  callingProductId: DotNsIdentifier,
  owner: DotNsIdentifier,
  disclosure: RingVrfKeyDisclosure,
});

export type ListRingVrfKeysResponse = CodecType<typeof ListRingVrfKeysResponseCodec>;
export const ListRingVrfKeysResponseCodec = Struct({
  // referencing to RemoteMessage.messageId
  respondingTo: str,
  payload: Result(Vector(RegisteredRingVrfKey), ListRingVrfKeysErr),
});
