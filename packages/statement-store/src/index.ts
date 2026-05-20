export type { Statement } from '@novasamatech/sdk-statement';

export type { SessionId } from './model/session.js';
export { SessionIdCodec, createSessionId } from './model/session.js';

export type { AccountId, LocalSessionAccount, RemoteSessionAccount, SessionAccount } from './model/sessionAccount.js';
export {
  AccountIdCodec,
  LocalSessionAccountCodec,
  RemoteSessionAccountCodec,
  createAccountId,
  createLocalSessionAccount,
  createRemoteSessionAccount,
} from './model/sessionAccount.js';

export type { Session } from './session/types.js';
export { createSession } from './session/session.js';
export { Request, Response, ResponseCode, StatementData } from './session/scale/statementData.js';

export type { StatementProver } from './session/statementProver.js';
export { createSr25519Prover } from './session/statementProver.js';

export type { Encryption } from './session/encyption.js';
export { createEncryption } from './session/encyption.js';

export { DecodingError, DecryptionError, UnknownError } from './session/error.js';

export type { LazyClient } from './adapter/lazyClient.js';
export { createLazyClient } from './adapter/lazyClient.js';
export type { StatementStoreAdapter } from './adapter/types.js';
export {
  AccountFullError,
  AlreadyExpiredError,
  BadProofError,
  DataTooLargeError,
  EncodingTooLargeError,
  ExpiryTooLowError,
  InternalStoreError,
  KnownExpiredError,
  NoAllowanceError,
  NoProofError,
  StorageFullError,
} from './adapter/types.js';
export { createPapiStatementStoreAdapter } from './adapter/rpc.js';

export {
  createSr25519Derivation,
  createSr25519Secret,
  deriveSlotAccountPublicKey,
  deriveSr25519PublicKey,
  ensureSubstrateSlotSr25519Ready,
  ensureSubstrateSr25519Ready,
  khash,
  signSlotAccountSecret,
  signWithSr25519Secret,
  verifySlotAccountSignature,
  verifySr25519Signature,
} from './crypto.js';
export { substrateSr25519PublicKey } from './substrateSr25519.js';
