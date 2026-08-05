import {
  ContextualAlias,
  CreateProofErr,
  DotNsIdentifier,
  GetAliasErr,
  ProductProofContext,
  RingLocation,
  RingVrfKeyHandle,
  RingVrfProof,
  RingVrfSignErr,
} from '@novasamatech/host-api';
import { Bytes } from '@novasamatech/scale';
import type { CodecType } from 'scale-ts';
import { Result, Struct, str } from 'scale-ts';

// RFC-0024 made the member key explicit: `keyHandle` names a slot in the owning
// product's ring VRF domain, and the Account Holder resolves it through the
// registry instead of picking a key on the caller's behalf. `callingProductId`
// is what the owner's allowlist is checked against when the handle is foreign.

export type RingVrfAliasRequest = CodecType<typeof RingVrfAliasRequestCodec>;
export const RingVrfAliasRequestCodec = Struct({
  callingProductId: DotNsIdentifier,
  keyHandle: RingVrfKeyHandle,
  context: ProductProofContext,
  ring: RingLocation,
});

export type RingVrfAliasResponse = CodecType<typeof RingVrfAliasResponseCodec>;
export const RingVrfAliasResponseCodec = Struct({
  respondingTo: str,
  payload: Result(ContextualAlias, GetAliasErr),
});

export type RingVrfProofRequest = CodecType<typeof RingVrfProofRequestCodec>;
export const RingVrfProofRequestCodec = Struct({
  callingProductId: DotNsIdentifier,
  keyHandle: RingVrfKeyHandle,
  context: ProductProofContext,
  ring: RingLocation,
  message: Bytes(),
});

export type RingVrfProofResponse = CodecType<typeof RingVrfProofResponseCodec>;
export const RingVrfProofResponseCodec = Struct({
  respondingTo: str,
  payload: Result(RingVrfProof, CreateProofErr),
});

/**
 * Host → Account Holder request for a plain signature by the ring VRF member key
 * itself (RFC-0024 `ring_vrf_sign`), rather than an anonymous ring proof.
 *
 * Carries no context and no ring: the signature derives no alias and proves no
 * membership, so there is nothing for either to scope. It is verified against
 * the member public key and is therefore linkable to every other use of the key.
 */
export type RingVrfSignRequest = CodecType<typeof RingVrfSignRequestCodec>;
export const RingVrfSignRequestCodec = Struct({
  callingProductId: DotNsIdentifier,
  keyHandle: RingVrfKeyHandle,
  message: Bytes(),
});

export type RingVrfSignResponse = CodecType<typeof RingVrfSignResponseCodec>;
export const RingVrfSignResponseCodec = Struct({
  respondingTo: str,
  payload: Result(Bytes(), RingVrfSignErr),
});
