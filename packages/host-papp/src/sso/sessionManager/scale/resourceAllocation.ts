import { DerivationIndex, DotNsIdentifier } from '@novasamatech/host-api';
import { Bytes, Status } from '@novasamatech/scale';
import type { CodecType } from 'scale-ts';
import { Enum, Result, Struct, Vector, _void, str } from 'scale-ts';

// Resource kinds that the Host can ask the Account Holder to allocate.
export type ApAllocatableResource = CodecType<typeof ApAllocatableResourceCodec>;
export const ApAllocatableResourceCodec = Enum({
  StatementStoreAllowance: _void,
  BulletInAllowance: _void,
  // Account the allowance is granted for, addressed by the RFC-0022 selector.
  SmartContractAllowance: DerivationIndex,
  AutoSigning: _void,
});

// Resources successfully allocated by the Account Holder, returned to the Host.
export type ApAllocatedResource = CodecType<typeof ApAllocatedResourceCodec>;
export const ApAllocatedResourceCodec = Enum({
  StatementStoreAllowance: Struct({
    slotAccountKey: Bytes(),
  }),
  BulletInAllowance: Struct({
    slotAccountKey: Bytes(),
  }),
  SmartContractAllowance: _void,
  // RFC-0022: the payload collapsed to the product-subtree secret key alone.
  // `//product//{productId}` is a hard junction, so this key exposes exactly
  // that product's subtree — the secret path component is gone.
  AutoSigning: Struct({
    // `Sr25519PrivateKey ++ Sr25519Nonce` (64 bytes): the full expanded secret
    // needed to sign and soft-derive `/{index}` below the product root.
    productRootPrivateKey: Bytes(),
    // RFC-0024: entropy of the `//{productId}` node of the ring VRF tree, which
    // is disjoint from the sr25519 product-account tree above. It lets the Host
    // derive the member secret of a *registered* key locally — the second
    // motivation being that a headless Account Holder execution context may not
    // fit a ring VRF proof inside its ~30 s / ~24 MB budget.
    //
    // Derivation from this entropy is unconditional arithmetic: nothing about
    // holding it distinguishes a meaningful index from a meaningless one, so the
    // registry supplies that distinction. A Host MUST NOT derive a member secret
    // for a `(product, index)` pair absent from its registry.
    ringVrfDomainEntropy: Bytes(),
  }),
});

export type ApAllocationOutcome = CodecType<typeof ApAllocationOutcomeCodec>;
export const ApAllocationOutcomeCodec = Enum({
  Allocated: ApAllocatedResourceCodec,
  Rejected: _void,
  NotAvailable: _void,
});

// Behavior when the requested resource already has an active allocation
// for this (user, product) pair on the Account Holder side.
export const OnExistingAllowancePolicyCodec = Status('Ignore', 'Increase');

export type ResourceAllocationRequest = CodecType<typeof ResourceAllocationRequestCodec>;
export const ResourceAllocationRequestCodec = Struct({
  callingProductId: DotNsIdentifier,
  resources: Vector(ApAllocatableResourceCodec),
  onExisting: OnExistingAllowancePolicyCodec,
});

export type ResourceAllocationResponse = CodecType<typeof ResourceAllocationResponseCodec>;
export const ResourceAllocationResponseCodec = Struct({
  // referencing to RemoteMessage.messageId
  respondingTo: str,
  payload: Result(Vector(ApAllocationOutcomeCodec), str),
});
