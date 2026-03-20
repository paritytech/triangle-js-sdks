/**
 * Utility functions for CID calculation and data manipulation
 */

import { blake2b } from '@noble/hashes/blake2.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { CID } from 'multiformats/cid';
import * as digest from 'multiformats/hashes/digest';
import type { Result } from 'neverthrow';
import { err, ok } from 'neverthrow';
import type { Binary } from 'polkadot-api';

import { MAX_CHUNK_SIZE } from './chunker.js';
import { BulletinError, CidCodec, HashAlgorithm } from './types.js';

/**
 * Convert unknown error to BulletinError
 */
export function toBulletinError(error: unknown): BulletinError {
  if (error instanceof BulletinError) return error;
  if (error instanceof Error) return new BulletinError(error.message, 'UNKNOWN', error);
  return new BulletinError(String(error), 'UNKNOWN');
}

/**
 * Calculate content hash using the specified algorithm
 *
 * Note: For production use, integrate with the pallet's hashing functions
 * via PAPI to ensure exact compatibility.
 */
export function getContentHash(data: Uint8Array, hashAlgorithm: HashAlgorithm): Result<Uint8Array, BulletinError> {
  switch (hashAlgorithm) {
    case HashAlgorithm.Blake2b256: {
      return ok(blake2b(data, { dkLen: 32 }));
    }
    case HashAlgorithm.Sha2_256: {
      return ok(sha256(data));
    }
    case HashAlgorithm.Keccak256: {
      return ok(keccak_256(data));
    }
    default:
      return err(new BulletinError(`Unsupported hash algorithm: ${hashAlgorithm}`, 'INVALID_HASH_ALGORITHM'));
  }
}

/**
 * Create a CID for data with specified codec and hashing algorithm
 *
 * Default to raw codec (0x55) with blake2b-256 hash (0xb220)
 */
export function calculateCid(
  data: Uint8Array,
  cidCodec = 0x55,
  hashAlgorithm: HashAlgorithm = HashAlgorithm.Blake2b256,
): Result<CID, BulletinError> {
  return getContentHash(data, hashAlgorithm).andThen(hash => {
    try {
      const mh = digest.create(hashAlgorithm, hash);
      return ok(CID.createV1(cidCodec, mh));
    } catch (error) {
      return err(new BulletinError(`Failed to calculate CID: ${error}`, 'CID_CALCULATION_FAILED', error));
    }
  });
}

/**
 * Convert CID to different codec while keeping the same hash
 */
export function convertCid(cid: CID, newCodec: number): CID {
  return CID.createV1(newCodec, cid.multihash);
}

/**
 * Parse CID from string
 */
export function parseCid(cidString: string): Result<CID, BulletinError> {
  try {
    return ok(CID.parse(cidString));
  } catch (error) {
    return err(new BulletinError(`Failed to parse CID: ${error}`, 'INVALID_CID', error));
  }
}

/** Convert Binary or Uint8Array to Uint8Array */
export function toBytes(data: Binary | Uint8Array): Uint8Array {
  return data instanceof Uint8Array ? data : data.asBytes();
}

/**
 * Parse CID from bytes
 */
export function cidFromBytes(bytes: Uint8Array): Result<CID, BulletinError> {
  try {
    return ok(CID.decode(bytes));
  } catch (error) {
    return err(new BulletinError(`Failed to decode CID from bytes: ${error}`, 'INVALID_CID', error));
  }
}

/**
 * Convert CID to bytes
 */
export function cidToBytes(cid: CID): Uint8Array {
  return cid.bytes;
}

/**
 * Estimate authorization needed for storing data
 *
 * @param dataSize - Total data size in bytes
 * @param chunkSize - Size of each chunk in bytes
 * @param createManifest - Whether a DAG-PB manifest will be created
 */
export function estimateAuthorization(
  dataSize: number,
  chunkSize: number,
  createManifest: boolean,
): { transactions: number; bytes: number } {
  const numChunks = Math.ceil(dataSize / chunkSize);
  let transactions = numChunks;
  let bytes = dataSize;

  if (createManifest) {
    transactions += 1;
    // Estimate manifest size (~50 bytes per DAG-PB link + overhead)
    bytes += numChunks * 50 + 1000;
  }

  return { transactions, bytes };
}

/**
 * SCALE variant type for the on-chain HashingAlgorithm enum
 */
export type ScaleHashingAlgorithm = { type: 'Blake2b256' } | { type: 'Sha2_256' } | { type: 'Keccak256' };

/**
 * Convert SDK HashAlgorithm (multicodec value) to the PAPI enum variant
 * expected for the on-chain `HashingAlgorithm` type.
 */
export function hashAlgorithmCodecToEnum(alg: HashAlgorithm): Result<ScaleHashingAlgorithm, BulletinError> {
  switch (alg) {
    case HashAlgorithm.Blake2b256:
      return ok({ type: 'Blake2b256' });
    case HashAlgorithm.Sha2_256:
      return ok({ type: 'Sha2_256' });
    case HashAlgorithm.Keccak256:
      return ok({ type: 'Keccak256' });
    default:
      return err(new BulletinError(`Unsupported hash algorithm for SCALE encoding: ${alg}`, 'INVALID_HASH_ALGORITHM'));
  }
}

/**
 * Check whether store options use non-default CID configuration.
 *
 * When true, the SDK should use `store_with_cid_config` instead of `store`
 * to ensure the on-chain CID matches the client-side CID.
 */
export function isNonDefaultCidConfig(cidCodec: CidCodec | number, hashAlgorithm: HashAlgorithm): boolean {
  return cidCodec !== CidCodec.Raw || hashAlgorithm !== HashAlgorithm.Blake2b256;
}

export function validateChunkSize(size: number): Result<void, BulletinError> {
  if (size <= 0) {
    return err(new BulletinError('Chunk size must be positive', 'INVALID_CHUNK_SIZE'));
  }

  if (size > MAX_CHUNK_SIZE) {
    return err(
      new BulletinError(`Chunk size ${size} bytes exceeds maximum ${MAX_CHUNK_SIZE} bytes`, 'CHUNK_TOO_LARGE'),
    );
  }

  return ok(undefined);
}
