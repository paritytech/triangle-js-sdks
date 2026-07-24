import { DerivationIndex, DotNsIdentifier } from '@novasamatech/host-api';
import { Status } from '@novasamatech/scale';
import type { CodecType } from 'scale-ts';
import { Bytes, Enum, Result, Struct, Vector, _void, str } from 'scale-ts';

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
