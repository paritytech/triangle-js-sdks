import { ErrEnum, Hex } from '@novasamatech/scale';
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

export const Account = Struct({
  publicKey: PublicKey,
  name: Option(str),
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

// account_get

export const AccountGetV1_request = ProductAccountId;
export const AccountGetV1_response = Result(Account, RequestCredentialsErr);

// account_get_alias

export const AccountGetAliasV1_request = ProductAccountId;
export const AccountGetAliasV1_response = Result(ContextualAlias, RequestCredentialsErr);

// account_create_proof

export const AccountCreateProofV1_request = Tuple(ProductAccountId, RingLocation, Bytes());
export const AccountCreateProofV1_response = Result(RingVrfProof, CreateProofErr);

// get_non_product_accounts

export const GetNonProductAccountsV1_request = _void;
export const GetNonProductAccountsV1_response = Result(Vector(Account), RequestCredentialsErr);
