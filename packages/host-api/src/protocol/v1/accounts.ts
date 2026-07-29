import { Bytes, Enum, ErrEnum, Hex, Status } from '@novasamatech/scale';
import type { CodecType } from 'scale-ts';
import { Option, Result, Struct, Tuple, Vector, _void, str, u32, u8 } from 'scale-ts';

import { GenericErr } from '../commonCodecs.js';

// common types

export const AccountId = Bytes(32);
export const PublicKey = Bytes();
export const DotNsIdentifier = str;

/**
 * Raw 32-byte derivation index — the escape hatch for byte-valued selectors.
 * Used directly as the soft-junction chain code of `//product//{productId}/{index}`.
 */
export const RawDerivationIndex = Bytes(32);

/**
 * Account selector within a product subtree: `Index(u32) | Raw([u8; 32])` (RFC 0022).
 *
 * `Index` is the primary form — plain indices keep a product's accounts
 * enumerable. `Raw` carries a raw 32-byte index. Hosts expand `Index(n)` to
 * the internal 32-byte index (`u32` little-endian ++ index magic) and pass
 * `Raw(bytes)` through unchanged.
 */
export const DerivationIndex = Enum({
  Index: u32,
  Raw: RawDerivationIndex,
});

export const ProductAccountId = Tuple(DotNsIdentifier, DerivationIndex);
export const RingVrgAlias = Bytes();

/**
 * Ergonomic form of an account selector: a plain index or a raw 32-byte index.
 */
export type AccountSelector = number | Uint8Array;

/**
 * Normalizes an {@link AccountSelector} into the wire {@link DerivationIndex}:
 * numbers become `Index`, 32-byte arrays become `Raw`.
 */
export function derivationIndexOf(selector: AccountSelector): CodecType<typeof DerivationIndex> {
  if (typeof selector === 'number') {
    return { tag: 'Index', value: selector };
  }

  if (selector.length !== RawDerivationIndex.size) {
    throw new Error(`Raw derivation index must be ${RawDerivationIndex.size} bytes, got ${selector.length}`);
  }

  return { tag: 'Raw', value: selector };
}

export const ProductId = DotNsIdentifier;

/**
 * Selector distinguishing proof contexts within a product (RFC 0004 amended by
 * RFC 0022). Expands to the same 32-byte derivation index as
 * {@link ProductAccountId}'s index, so the alias ↔ account mapping is the
 * identity on it.
 */
export const ProductProofContextSuffix = DerivationIndex;
export const ProductProofContext = Tuple(ProductId, ProductProofContextSuffix);

// structs

export const ProductAccount = Struct({
  publicKey: PublicKey,
});

export const LegacyAccount = Struct({
  publicKey: PublicKey,
  name: Option(str),
});

export const UserIdentity = Struct({
  primaryUsername: DotNsIdentifier,
});

export const ContextualAlias = Struct({
  context: Bytes(32),
  alias: RingVrgAlias,
});

export const RingVrfProof = Struct({
  proof: Bytes(),
  contextualAlias: ContextualAlias,
  ringIndex: u32,
  ringRevision: u32,
});

export const RingLocationJunction = Enum({
  PalletInstance: u8,
  CollectionId: Bytes(),
});

export const RingLocation = Struct({
  // TODO make GenesisHash fixed size and replace hardcoded codec with it
  chainId: Hex(32),
  junctions: Vector(RingLocationJunction),
});

/** One `transcript.append_message(label, value)` call replayed by the host. */
export const VrfTranscriptItem = Struct({
  label: Bytes(),
  value: Bytes(),
});

/** schnorrkel VRF output: a 32-byte `VRFPreOut` and a 64-byte `VRFProof`. */
export const VrfSignature = Struct({
  preOutput: Bytes(32),
  proof: Bytes(64),
});

// errors

export const RequestCredentialsErr = ErrEnum('RequestCredentialsErr', {
  NotConnected: [_void, 'RequestCredentials: not connected'],
  Rejected: [_void, 'RequestCredentials: rejected'],
  DomainNotValid: [_void, 'RequestCredentials: domain not valid'],
  Unknown: [GenericErr, 'RequestCredentials: unknown error'],
});

export const CreateProofErr = ErrEnum('CreateProofErr', {
  RingNotFound: [_void, 'CreateProof: ring not found'],
  NotMember: [_void, 'CreateProof: selected member key is not a member of the ring'],
  Rejected: [_void, 'CreateProof: rejected'],
  Unknown: [GenericErr, 'CreateProof: unknown error'],
});

export const GetAliasErr = ErrEnum('GetAliasErr', {
  RingNotFound: [_void, 'GetAlias: ring not found'],
  NotMember: [_void, 'GetAlias: selected member key is not a member of the ring'],
  Rejected: [_void, 'GetAlias: rejected'],
  Unknown: [GenericErr, 'GetAlias: unknown error'],
});

export const GetUserIdErr = ErrEnum('GetUserIdErr', {
  PermissionDenied: [_void, 'GetUserId: permission denied'],
  NotConnected: [_void, 'GetUserId: not connected'],
  Unknown: [GenericErr, 'GetUserId: unknown error'],
});

export const SignVrfErr = ErrEnum('SignVrfErr', {
  NotConnected: [_void, 'SignVrf: not connected'],
  Rejected: [_void, 'SignVrf: rejected'],
  Unknown: [GenericErr, 'SignVrf: unknown error'],
});

// account connection status

export const AccountConnectionStatus = Status('disconnected', 'connected');

export const AccountConnectionStatusV1_start = _void;
export const AccountConnectionStatusV1_receive = AccountConnectionStatus;
export const AccountConnectionStatusV1_interrupt = _void;

// get_user_id

export const GetUserIdV1_request = _void;
export const GetUserIdV1_response = Result(UserIdentity, GetUserIdErr);

// account_get

export const AccountGetV1_request = ProductAccountId;
export const AccountGetV1_response = Result(ProductAccount, RequestCredentialsErr);

// account_get_alias

export const AccountGetAliasV1_request = Tuple(ProductProofContext, RingLocation);
export const AccountGetAliasV1_response = Result(ContextualAlias, GetAliasErr);

// account_create_proof

export const AccountCreateProofV1_request = Tuple(ProductProofContext, RingLocation, Bytes());
export const AccountCreateProofV1_response = Result(RingVrfProof, CreateProofErr);

// account_sign_vrf

/**
 * The host replays the transcript verbatim — `Transcript::new(transcriptLabel)`
 * followed by `append_message(item.label, item.value)` per item, in order — and
 * performs no interpretation of labels or values (RFC-0023).
 */
export const AccountSignVrfV1_request = Struct({
  account: ProductAccountId,
  transcriptLabel: Bytes(),
  items: Vector(VrfTranscriptItem),
});
export const AccountSignVrfV1_response = Result(VrfSignature, SignVrfErr);

// get_legacy_accounts

export const GetLegacyAccountsV1_request = _void;
export const GetLegacyAccountsV1_response = Result(Vector(LegacyAccount), RequestCredentialsErr);

// request_login

export const LoginResult = Status('success', 'alreadyConnected', 'rejected');

export const LoginErr = ErrEnum('LoginErr', {
  Unknown: [GenericErr, 'Login: unknown error'],
});

export const RequestLoginV1_request = Option(str);
export const RequestLoginV1_response = Result(LoginResult, LoginErr);
