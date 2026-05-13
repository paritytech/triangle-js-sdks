export type { BulletinDescriptor, CreateBulletinClientOptions } from './createBulletinClient.js';
export { createBulletinClient } from './createBulletinClient.js';

export type { BulletinNetwork } from './constants.js';
export { BulletinChain } from './constants.js';

export type {
  BulletinClientInterface,
  BulletinTypedApi,
  ClientConfig,
  ProgressCallback,
  ProgressEvent,
  StoreOptions,
  StoreResult,
  SubmitFn,
  TransactionReceipt,
  TransactionStatusEvent,
} from '@parity/bulletin-sdk';

export {
  AsyncBulletinClient,
  BulletinError,
  BulletinPreparer,
  CID,
  ChunkStatus,
  CidCodec,
  ErrorCode,
  HashAlgorithm,
  TxStatus,
  WaitFor,
  calculateCid,
  cidFromBytes,
  getContentHash,
  parseCid,
} from '@parity/bulletin-sdk';
