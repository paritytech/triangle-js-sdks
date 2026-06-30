import { Enum, ErrEnum, Status } from '@novasamatech/scale';
import { Bytes, Option, Result, Struct, Tuple, Vector, _void, str, u32, u8 } from 'scale-ts';

import { GenericErr, GenesisHash } from '../commonCodecs.js';

// common types

export const AccountId = Bytes(32);
export const PublicKey = Bytes();
export const DotNsIdentifier = str;
export const DerivationIndex = u32;
export const ProductAccountId = Tuple(DotNsIdentifier, DerivationIndex);
export const RingVrgAlias = Bytes();

export const ProductId = DotNsIdentifier;
export const ProductProofContextSuffix = Bytes();
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

export const GetUserIdErr = ErrEnum('GetUserIdErr', {
  PermissionDenied: [_void, 'GetUserId: permission denied'],
  NotConnected: [_void, 'GetUserId: not connected'],
  Unknown: [GenericErr, 'GetUserId: unknown error'],
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
export const AccountGetAliasV1_response = Result(ContextualAlias, RequestCredentialsErr);

// account_create_proof

export const AccountCreateProofV1_request = Tuple(ProductProofContext, RingLocation, Bytes());
export const AccountCreateProofV1_response = Result(RingVrfProof, CreateProofErr);

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
