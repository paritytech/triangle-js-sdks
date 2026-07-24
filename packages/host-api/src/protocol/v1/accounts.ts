import { ErrEnum, Hex, Status } from '@novasamatech/scale';
import { Bytes, Option, Result, Struct, Tuple, Vector, _void, str, u32 } from 'scale-ts';

import { GenericErr, GenesisHash } from '../commonCodecs.js';

// common types

export const AccountId = Bytes(32);
export const PublicKey = Bytes();
export const DotNsIdentifier = str;
export const DerivationIndex = u32;
export const ProductAccountId = Tuple(DotNsIdentifier, DerivationIndex);
export const RingVrfProof = Bytes();
export const RingVrgAlias = Bytes();

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

export const RingLocationHint = Struct({
  palletInstance: Option(u32),
});

export const RingLocation = Struct({
  genesisHash: GenesisHash,
  ringRootHash: Hex(),
  hints: Option(RingLocationHint),
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
  Rejected: [_void, 'CreateProof: rejected'],
  Unknown: [GenericErr, 'CreateProof: unknown error'],
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

export const AccountGetAliasV1_request = ProductAccountId;
export const AccountGetAliasV1_response = Result(ContextualAlias, RequestCredentialsErr);

// account_create_proof

export const AccountCreateProofV1_request = Tuple(ProductAccountId, RingLocation, Bytes());
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
