/**
 * Single-device session (base-spec.md): the pairwise Request/Response transport used by
 * SSO and any peer known to run exactly one device.
 *
 * See `multiDeviceSession.ts` for the mds.md variant, and `core.ts` for the shared driver.
 */

import type { StatementStoreAdapter } from '../adapter/types.js';
import { createSessionId } from '../model/session.js';
import type { LocalSessionAccount, RemoteSessionAccount } from '../model/sessionAccount.js';
import type { ExpiryAllocator } from '../submit/allocator.js';
import { createExpiryAllocator } from '../submit/allocator.js';

import { createStatementDecoder } from './codec/decoder.js';
import { createStaticTopics } from './codec/incomingTopics.js';
import { createBodyBuilder } from './codec/outgoingBody.js';
import { DEFAULT_MAX_REQUEST_SIZE, createSessionCore } from './core.js';
import type { Encryption } from './encyption.js';
import type { StatementProver } from './statementProver.js';
import type { Session } from './types.js';

export type SessionParams = {
  localAccount: LocalSessionAccount;
  remoteAccount: RemoteSessionAccount;
  statementStore: StatementStoreAdapter;
  encryption: Encryption;
  prover: StatementProver;
  /**
   * Keyed-hash input for SessionId derivation:
   *   SessionId(A, B) = khash(sessionKey, "session" : AccountId(A) : AccountId(B) : "/" : "/")
   *
   * Required because blake2b's key length is bounded (≤ 64 bytes) and the
   * caller must decide what semantically goes here. V1 sessions historically
   * passed `remoteAccount.publicKey` (33-byte compressed P-256 — fits) which
   * conflated the encryption pubkey with the session-derivation key. The V2
   * spec (Mobile SSO v0.2.2) is explicit that SessionId is keyed by the
   * ECDH-derived shared secret, so V2 callers should pass that 32-byte value
   * directly. Pass any 32–64 byte material; out-of-range inputs make blake2b
   * throw.
   */
  sessionKey: Uint8Array;
  /**
   * Expiry source for this session's submits. Inject ONE shared allocator when
   * several writers (sessions, raw submits) sign with the same account, so
   * same-second submits cannot tie. Defaults to a private allocator —
   * identical to the previous per-session behavior.
   */
  allocator?: ExpiryAllocator;
  /**
   * Statement size budget in bytes; the batch is sized against
   * `maxRequestSize - STATEMENT_OVERHEAD`. Defaults to
   * {@link DEFAULT_MAX_REQUEST_SIZE} — override only to be MORE conservative than the
   * chain, never less.
   */
  maxRequestSize?: number;
};

/**
 * Single-device session (base-spec.md). Wire output is unchanged from before the
 * multi-device seams existed: `StatementData.request`/`.response` on
 * `SessionId(A, B)`, listening on `SessionId(B, A)`.
 */
export function createSession({
  localAccount,
  remoteAccount,
  statementStore,
  encryption,
  prover,
  sessionKey,
  allocator = createExpiryAllocator(),
  maxRequestSize = DEFAULT_MAX_REQUEST_SIZE,
}: SessionParams): Session {
  const outgoingTopic = createSessionId(sessionKey, localAccount, remoteAccount);
  const incomingTopic = createSessionId(sessionKey, remoteAccount, localAccount);

  return createSessionCore({
    statementStore,
    prover,
    allocator,
    maxRequestSize,
    outgoingTopic,
    bodyBuilder: createBodyBuilder({ topic: outgoingTopic, encryption }),
    incomingTopics: createStaticTopics({
      topic: incomingTopic,
      senderEncryptionPublicKey: remoteAccount.publicKey,
      encryption,
    }),
    // No envelope: a single-device session neither emits nor accepts multi-device variants.
    decoder: createStatementDecoder({ prover, ownEncryption: encryption }),
    peerDevices: () => [],
  });
}
