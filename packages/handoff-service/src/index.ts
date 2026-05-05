// RPC client
export type { HopClient } from './rpc/index.js';
export { createHopClient } from './rpc/index.js';
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
export type { DownloadParams, UploadParams, UploadResult } from './fileLoader/index.js';
export { downloadFile, uploadFile } from './fileLoader/index.js';

// Codec (internal pool metadata)
export { UploadedFile } from './codec.js';
