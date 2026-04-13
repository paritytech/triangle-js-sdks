import { Enum, ErrEnum, Hex } from '@novasamatech/scale';
import { Bytes, Option, Result, Struct, Vector, _void, bool, str, u32 } from 'scale-ts';

import { GenericErr, GenesisHash } from '../commonCodecs.js';

import { ProductAccountId } from './accounts.js';

// common structures

export const SigningErr = ErrEnum('SigningErr', {
  FailedToDecode: [_void, 'Failed to decode'],
  Rejected: [_void, 'Rejected'],
  PermissionDenied: [_void, 'Permission denied'],
  Unknown: [GenericErr, ({ reason }) => reason || 'Unknown error'],
});

export const SigningResult = Struct({
  signature: Hex(),
  signedTransaction: Option(Hex()),
});

// sign raw

export const RawPayload = Enum({
  Bytes: Bytes(),
  Payload: str,
});

export const SigningRawPayload = Struct({
  account: ProductAccountId,
  payload: RawPayload,
});

export const SigningRawPayloadWithoutAccount = Struct({
  signer: str,
  payload: RawPayload,
});

export const SignRawV1_request = SigningRawPayload;
export const SignRawV1_response = Result(SigningResult, SigningErr);

export const SignRawWithLegacyAccountV1_request = SigningRawPayloadWithoutAccount;
export const SignRawWithLegacyAccountV1_response = Result(SigningResult, SigningErr);

// sign payload

const SigningPayloadPayload = Struct({
  blockHash: Hex(),
  blockNumber: Hex(),
  era: Hex(),
  genesisHash: GenesisHash,
  method: Hex(),
  nonce: Hex(),
  specVersion: Hex(),
  tip: Hex(),
  transactionVersion: Hex(),
  signedExtensions: Vector(str),
  version: u32,
  assetId: Option(Hex()),
  metadataHash: Option(Hex()),
  mode: Option(u32),
  withSignedTransaction: Option(bool),
});

export const SigningPayload = Struct({
  account: ProductAccountId,
  payload: SigningPayloadPayload,
});

export const SigningPayloadWithoutAccount = Struct({
  signer: str,
  payload: SigningPayloadPayload,
});

export const SignPayloadV1_request = SigningPayload;
export const SignPayloadV1_response = Result(SigningResult, SigningErr);

export const SignPayloadWithLegacyAccountV1_request = SigningPayloadWithoutAccount;
export const SignPayloadWithLegacyAccountV1_response = Result(SigningResult, SigningErr);
