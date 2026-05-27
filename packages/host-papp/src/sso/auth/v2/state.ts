/**
 * Handshake V2 state machine — the public-facing observable shape of an
 * in-flight SSO pairing exchange.
 *
 * Maps directly onto the inner `EncryptedHandshakeResponseV2` enum:
 *
 *   Idle       — no proposal emitted yet
 *   Submitted  — proposal QR shown, waiting for the first response statement
 *   Pending    — peer acknowledged; allocating Statement Store allowance on-chain
 *   Success    — final state; identity keys received, device authorised
 *   Failed     — final state; peer rejected (declined / duplicate / no-slot / tx-failed)
 *
 * Transitions are unidirectional except for Failed → Idle (user retries).
 * The state object is what UIs render and what the chat layer gates on
 * before submitting any V2 statements.
 */

import type { DecodedHandshakeResponseV2 } from '../scale/handshakeV2.js';
import { deriveIdentityChatPublicKey } from '../scale/handshakeV2.js';

export type HandshakeIdleState = { tag: 'Idle' };
export type HandshakeSubmittedState = { tag: 'Submitted' };
export type HandshakePendingState = { tag: 'Pending'; reason: 'AllowanceAllocation' };
export type HandshakeSuccessState = {
  tag: 'Success';
  /** User identity sr25519 accountId (32 bytes). */
  identityAccountId: Uint8Array;
  /**
   * User root sr25519 accountId (32 bytes) — the parent for soft-derivation
   * of product accounts. Nullable: peers on spec v0.2 (Android
   * `feature/location-for-handshake`) omit this field. Product-account
   * derivation degrades gracefully when absent; chat does not use it.
   */
  rootAccountId: Uint8Array | null;
  /**
   * User identity chat P-256 private key (32 bytes raw scalar) shared by
   * PApp with this device per the multi-device spec. Sensitive; persist in
   * OS-keychain-backed secure storage and never forward.
   */
  identityChatPrivateKey: Uint8Array;
  /**
   * Derived locally from `identityChatPrivateKey` via P-256 scalar
   * multiplication (uncompressed 65-byte form). Both sides MUST derive
   * identically; downstream session topics depend on it.
   */
  identityChatPublicKey: Uint8Array;
  /**
   * Encryption public key of the authorising PApp device (65 bytes,
   * P-256 uncompressed). Used by the host when addressing chat envelopes
   * back to the authorising device.
   */
  deviceEncPubKey: Uint8Array;
  /**
   * `papp_encr_pub` from the Mobile SSO spec (v0.2.2 — 65 bytes, P-256
   * uncompressed). The host's SSO session transport derives
   * `shared_secret_session = ECDH(host_encr_secret, ssoEncPubKey)` from
   * this. Nullable because v0.2 and v0.2.1 peers don't ship it; while
   * null the host's SSO transport stays inactive (sign/vrf/etc continue
   * to fail at the boundary) and chat keeps working through
   * `identityChatPrivateKey`.
   */
  ssoEncPubKey: Uint8Array | null;
  /**
   * The pairing-topic statement was signed by PApp's device statement
   * account. `HandshakeSuccessV2` doesn't carry it in the encrypted body, so
   * the pairing service lifts it off `statement.proof.value.signer` and
   * attaches it here. `null` only when the statement arrived without a
   * recognised proof type, in which case device-sync can't seed back to PApp.
   */
  peerStatementAccountId: Uint8Array | null;
};
export type HandshakeFailedState = { tag: 'Failed'; reason: string };

export type HandshakeState =
  | HandshakeIdleState
  | HandshakeSubmittedState
  | HandshakePendingState
  | HandshakeSuccessState
  | HandshakeFailedState;

export const idle = (): HandshakeIdleState => ({ tag: 'Idle' });

export const submitted = (): HandshakeSubmittedState => ({ tag: 'Submitted' });

/**
 * Translate the length-dispatched-decoded `EncryptedHandshakeResponseV2` into
 * the public state. Pure — no I/O. The caller decrypts the outer envelope and
 * runs `decodeEncryptedHandshakeResponseV2` first.
 */
export const fromInnerResponse = (
  response: DecodedHandshakeResponseV2,
  peerStatementAccountId: Uint8Array | null = null,
): HandshakeState => {
  switch (response.tag) {
    case 'Pending':
      // Only AllowanceAllocation today; widen here when the spec adds more variants.
      return { tag: 'Pending', reason: 'AllowanceAllocation' };
    case 'Success':
      return {
        tag: 'Success',
        identityAccountId: response.value.identityAccountId,
        rootAccountId: response.value.rootAccountId,
        identityChatPrivateKey: response.value.identityChatPrivateKey,
        identityChatPublicKey: deriveIdentityChatPublicKey(response.value.identityChatPrivateKey),
        deviceEncPubKey: response.value.deviceEncPubKey,
        ssoEncPubKey: response.value.ssoEncPubKey,
        peerStatementAccountId,
      };
    case 'Failed':
      return { tag: 'Failed', reason: response.value };
  }
};

/**
 * Forward-only transition guard: rejects regressions like Success → Pending.
 * Idempotent on same-tag transitions (returns current by reference) so callers
 * can use `next === current` to detect "no change" without per-call equality.
 */
export const advance = (current: HandshakeState, next: HandshakeState): HandshakeState => {
  if (isTerminal(current)) return current;
  if (current.tag === 'Idle' && next.tag !== 'Submitted') return current;
  if (current.tag === 'Submitted' && next.tag === 'Idle') return current;
  if (current.tag === next.tag) return current;
  return next;
};

export const isTerminal = (state: HandshakeState): state is HandshakeSuccessState | HandshakeFailedState =>
  state.tag === 'Success' || state.tag === 'Failed';

/**
 * True only when the device is authorised to submit V2 statements. The
 * chat-send path gates on this — V2 messages must wait for allowance.
 */
export const canSubmitV2Statements = (state: HandshakeState): state is HandshakeSuccessState => state.tag === 'Success';
