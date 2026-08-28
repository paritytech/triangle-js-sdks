import { Bytes, Enum, ErrEnum, Status } from '@novasamatech/scale';
import type { CodecType } from 'scale-ts';
import { Option, Struct, Tuple, Vector, _void, str, u32, u8 } from 'scale-ts';

import { CallResult } from '../callError.js';
import { GenericErr, GenesisHash } from '../commonCodecs.js';

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
 * Public name of a registered ring VRF key (RFC-0024): the owning product plus
 * the index of the key inside that product's ring VRF domain (`//{productId}//{index}`
 * of the ring VRF tree, RFC-0022).
 *
 * Structurally a {@link ProductAccountId}, but it names a slot in the ring VRF
 * tree — *not* the sr25519 product account at the same `(product, index)`.
 * Consumers MUST treat it as opaque and select keys by declared
 * {@link RingLocation}; the index is the owner's implementation detail.
 */
export const RingVrfKeyHandle = ProductAccountId;

/** Ring VRF member public key. Linkable across every ring the key appears in. */
export const RingVrfPublicKey = Bytes(32);

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
  chainId: GenesisHash,
  junctions: Vector(RingLocationJunction),
});

/**
 * How much of a registry entry the caller is asking for (RFC-0024).
 *
 * `PublicKey` is owner-visible by default but permissioned cross-product: a
 * member public key is linkable across every ring it appears in.
 */
export const RingVrfKeyDisclosure = Status('Anonymized', 'PublicKey');

/**
 * A ring VRF key registry entry as returned to a caller (RFC-0024).
 *
 * `rings` is what the owning product *declared* the key for, not proof of
 * membership — membership is still discovered only by attempting a proof, which
 * fails with `NotMember`. `publicKey` is present only when the caller owns the
 * key or asked for (and was granted) `PublicKey` disclosure.
 */
export const RegisteredRingVrfKey = Struct({
  handle: RingVrfKeyHandle,
  rings: Vector(RingLocation),
  publicKey: Option(RingVrfPublicKey),
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
  KeyNotRegistered: [_void, 'CreateProof: key handle has no registry entry'],
  KeyNotInRing: [_void, 'CreateProof: key handle is registered, but not for the requested ring'],
  NotAllowlisted: [_void, 'CreateProof: key handle is foreign and its owner has not allowlisted the caller'],
  Rejected: [_void, 'CreateProof: rejected'],
  Unknown: [GenericErr, 'CreateProof: unknown error'],
});

export const GetAliasErr = ErrEnum('GetAliasErr', {
  RingNotFound: [_void, 'GetAlias: ring not found'],
  NotMember: [_void, 'GetAlias: selected member key is not a member of the ring'],
  KeyNotRegistered: [_void, 'GetAlias: key handle has no registry entry'],
  KeyNotInRing: [_void, 'GetAlias: key handle is registered, but not for the requested ring'],
  Rejected: [_void, 'GetAlias: rejected'],
  Unknown: [GenericErr, 'GetAlias: unknown error'],
});

export const RegisterRingVrfKeyErr = ErrEnum('RegisterRingVrfKeyErr', {
  NotConnected: [_void, 'RegisterRingVrfKey: not connected'],
  RingNotFound: [_void, 'RegisterRingVrfKey: ring not found'],
  Rejected: [_void, 'RegisterRingVrfKey: rejected'],
  Unknown: [GenericErr, 'RegisterRingVrfKey: unknown error'],
});

export const ListRingVrfKeysErr = ErrEnum('ListRingVrfKeysErr', {
  NotConnected: [_void, 'ListRingVrfKeys: not connected'],
  Rejected: [_void, 'ListRingVrfKeys: owner is not the calling product and the caller has no grant for it'],
  Unknown: [GenericErr, 'ListRingVrfKeys: unknown error'],
});

export const RingVrfSignErr = ErrEnum('RingVrfSignErr', {
  NotConnected: [_void, 'RingVrfSign: not connected'],
  KeyNotRegistered: [_void, 'RingVrfSign: key handle has no registry entry'],
  NotAllowlisted: [_void, 'RingVrfSign: key handle is foreign and its owner has not allowlisted the caller'],
  Rejected: [_void, 'RingVrfSign: rejected'],
  Unknown: [GenericErr, 'RingVrfSign: unknown error'],
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
export const GetUserIdV1_response = CallResult(UserIdentity, GetUserIdErr);

// account_get

export const AccountGetV1_request = ProductAccountId;
export const AccountGetV1_response = CallResult(ProductAccount, RequestCredentialsErr);

// account_get_alias

/**
 * `(keyHandle, context, ring)` — RFC-0024 replaced RFC-0004's host-side member
 * key selection with an explicit handle. `ring` stays a separate argument
 * because a key may be registered for several; the host MUST check that `ring`
 * is among the handle's declared rings and fail with `KeyNotInRing` otherwise.
 */
export const AccountGetAliasV1_request = Tuple(RingVrfKeyHandle, ProductProofContext, RingLocation);
export const AccountGetAliasV1_response = CallResult(ContextualAlias, GetAliasErr);

// account_create_proof

/** `(keyHandle, context, ring, message)` — see {@link AccountGetAliasV1_request}. */
export const AccountCreateProofV1_request = Tuple(RingVrfKeyHandle, ProductProofContext, RingLocation, Bytes());
export const AccountCreateProofV1_response = CallResult(RingVrfProof, CreateProofErr);

// account_register_ring_vrf_key

/**
 * `(index, ring)` — registers a key the *calling* product owns. Ownership is the
 * calling product id and is never a parameter, so registration needs no
 * capability gate and no prompt. Registering an already-registered `index` for
 * an additional `ring` extends the existing entry rather than creating a second
 * one (RFC-0024).
 */
export const AccountRegisterRingVrfKeyV1_request = Tuple(DerivationIndex, RingLocation);
export const AccountRegisterRingVrfKeyV1_response = CallResult(RingVrfPublicKey, RegisterRingVrfKeyErr);

// account_list_ring_vrf_keys

/** `(owner, disclosure)` — lists the registry entries owned by `owner` (RFC-0024). */
export const AccountListRingVrfKeysV1_request = Tuple(ProductId, RingVrfKeyDisclosure);
export const AccountListRingVrfKeysV1_response = CallResult(Vector(RegisteredRingVrfKey), ListRingVrfKeysErr);

// account_ring_vrf_sign

/**
 * `(keyHandle, message)` — signs `message` with the member key itself, producing
 * an ordinary signature rather than an anonymous ring proof (RFC-0024).
 *
 * Takes neither a context nor a ring: it derives no alias and proves no
 * membership, so there is nothing for either to scope. Verified against the
 * member public key, which makes every such signature linkable to every other
 * use of that key.
 */
export const AccountRingVrfSignV1_request = Tuple(RingVrfKeyHandle, Bytes());
export const AccountRingVrfSignV1_response = CallResult(Bytes(), RingVrfSignErr);

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
export const AccountSignVrfV1_response = CallResult(VrfSignature, SignVrfErr);

// get_legacy_accounts

export const GetLegacyAccountsV1_request = _void;
export const GetLegacyAccountsV1_response = CallResult(Vector(LegacyAccount), RequestCredentialsErr);

// request_login

export const LoginResult = Status('success', 'alreadyConnected', 'rejected');

export const LoginErr = ErrEnum('LoginErr', {
  Unknown: [GenericErr, 'Login: unknown error'],
});

export const RequestLoginV1_request = Option(str);
export const RequestLoginV1_response = CallResult(LoginResult, LoginErr);
