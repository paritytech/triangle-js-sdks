// RPC client
export type { HopClient } from './rpc/index.js';
export {
  BitswapErrorCode,
  HopErrorCode,
  HopRpcError,
  bitswapBytesMatchHash,
  createHopClient,
  hopBitswapCid,
} from './rpc/index.js';
export type { HexString, PoolStatus, RequestFn } from './rpc/index.js';

// Crypto
export type { FileEncryption, FileTicket } from './crypto/index.js';
export {
  createFileEncryption,
  deriveEncryptionKey,
  derivePublicKey,
  deriveSigningKeypair,
  deriveSigningSeed,
  generateTicket,
  signWithTicket,
} from './crypto/index.js';

// File loader
export type { BitswapRetryPolicy, DownloadParams, UploadParams, UploadResult } from './fileLoader/index.js';
export { downloadFile, uploadFile } from './fileLoader/index.js';

// Codec (pool entry layouts). `ChunkedFile` stays internal — it is an alias of
// `UploadedFile` and has no meaning outside the versioned envelope.
export type { VersionedUploadedFilePayload } from './codec.js';
export { UploadedFile, VersionedUploadedFile, decodeRootEntry } from './codec.js';
