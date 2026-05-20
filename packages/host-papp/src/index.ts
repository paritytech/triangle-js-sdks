export { SS_PASEO_STABLE_STAGE_ENDPOINTS, SS_PREVIEW_STAGE_ENDPOINTS, SS_STABLE_STAGE_ENDPOINTS } from './constants.js';

export type { PappAdapter } from './papp.js';
export { createPappAdapter } from './papp.js';

export type { HostMetadata } from './sso/auth/impl.js';
export type { PairingStatus } from './sso/auth/types.js';
export type { UserSession } from './sso/sessionManager/userSession.js';
export type { StoredUserSession } from './sso/userSessionRepository.js';
export type { Identity } from './identity/types.js';

export type {
  SigningPayloadRequest,
  SigningPayloadResponse,
  SigningRawRequest,
  SigningRequest,
} from './sso/sessionManager/scale/signing.js';
export type { RingVrfAliasRequest, RingVrfAliasResponse } from './sso/sessionManager/scale/ringVrf.js';

// ── V2 SSO handshake ─────────────────────────────────────────────────────

export type { EncryptedHandshakeResponseV2Value } from './sso/auth/scale/handshakeV2.js';
export {
  Device,
  EncryptedHandshakeResponseV1,
  EncryptedHandshakeResponseV2,
  HandshakeProposalV2,
  HandshakeResponseV1,
  HandshakeResponseV2,
  HandshakeStatusV2,
  HandshakeSuccessV2,
  IDENTITY_SIGNATURE_PAYLOAD_BYTES,
  MetadataEntry,
  MetadataKey,
  VersionedHandshakeProposal,
  VersionedHandshakeResponse,
} from './sso/auth/scale/handshakeV2.js';

export { computePairingChannel, computePairingTopic } from './sso/auth/v2/topic.js';

export type { HandshakeMetadata, HandshakeProposalDevice } from './sso/auth/v2/proposal.js';
export { buildPairingDeeplink, encodeProposal } from './sso/auth/v2/proposal.js';

export type { HandshakeResponseEnvelope } from './sso/auth/v2/envelope.js';
export { decryptResponseEnvelope } from './sso/auth/v2/envelope.js';

export type {
  HandshakeFailedState,
  HandshakeIdleState,
  HandshakePendingState,
  HandshakeState,
  HandshakeSubmittedState,
  HandshakeSuccessState,
} from './sso/auth/v2/state.js';
export { advance, canSubmitV2Statements, fromInnerResponse, idle, isTerminal, submitted } from './sso/auth/v2/state.js';

export type { DeviceIdentityForPairing, Pairing, StartPairingDeps } from './sso/auth/v2/service.js';
export { startPairingV2 } from './sso/auth/v2/service.js';
