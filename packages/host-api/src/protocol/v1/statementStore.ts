import { Enum, ErrEnum } from '@novasamatech/scale';
import { Bytes, Option, Result, Struct, Tuple, Vector, _void, u32, u64 } from 'scale-ts';

import { GenericErr, GenericError } from '../commonCodecs.js';

import { ProductAccountId } from './accounts.js';

// structs definition

export const Topic = Bytes(32);
export const Channel = Bytes(32);
export const DecryptionKey = Bytes(32);

// Proof structures
const Sr25519StatementProof = Struct({
  signature: Bytes(64),
  signer: Bytes(32),
});

const Ed25519StatementProof = Struct({
  signature: Bytes(64),
  signer: Bytes(32),
});

const EcdsaStatementProof = Struct({
  signature: Bytes(65),
  signer: Bytes(33),
});

const OnChainStatementProof = Struct({
  who: Bytes(32),
  blockHash: Bytes(32),
  event: u64,
});

const StatementProof = Enum({
  Sr25519: Sr25519StatementProof,
  Ed25519: Ed25519StatementProof,
  Ecdsa: EcdsaStatementProof,
  OnChain: OnChainStatementProof,
});

export const Statement = Struct({
  proof: Option(StatementProof),
  decryptionKey: Option(DecryptionKey),
  priority: Option(u32),
  channel: Option(Channel),
  topics: Vector(Topic),
  data: Option(Bytes()),
});

export const SignedStatement = Struct({
  proof: StatementProof,
  decryptionKey: Option(DecryptionKey),
  priority: Option(u32),
  channel: Option(Channel),
  topics: Vector(Topic),
  data: Option(Bytes()),
});

// query

export const StatementStoreQueryV1_request = Vector(Topic);
export const StatementStoreQueryV1_response = Result(Vector(SignedStatement), GenericError);

export const StatementStoreSubscribeV1_start = Vector(Topic);
export const StatementStoreSubscribeV1_receive = Vector(SignedStatement);

// creating proof

export const StatementProofErr = ErrEnum('StatementProofErr', {
  UnableToSign: [_void, 'StatementProof: unable to sign'],
  UnknownAccount: [_void, 'StatementProof: unknown account'],
  Unknown: [GenericErr, 'StatementProof: unknown error'],
});

export const StatementStoreCreateProofV1_request = Tuple(ProductAccountId, Statement);
export const StatementStoreCreateProofV1_response = Result(StatementProof, StatementProofErr);

// submit

export const StatementStoreSubmitV1_request = SignedStatement;
export const StatementStoreSubmitV1_response = Result(_void, GenericError);
