import { toHex } from '@novasamatech/scale';
import type { Statement } from '@novasamatech/sdk-statement';
import { nanoid } from 'nanoid';
import { ResultAsync, err, errAsync, fromPromise, fromThrowable, ok, okAsync } from 'neverthrow';
import type { Codec, CodecType } from 'scale-ts';
import { Struct, str } from 'scale-ts';

import type { StatementStoreAdapter } from '../adapter/types.js';
import { khash, stringToBytes } from '../crypto.js';
import { nonNullable, toError } from '../helpers.js';
import type { SessionId } from '../model/session.js';
import { createSessionId } from '../model/session.js';
import type { LocalSessionAccount, RemoteSessionAccount } from '../model/sessionAccount.js';
import type { ExpiryAllocator } from '../submit/allocator.js';
import { createExpiryAllocator } from '../submit/allocator.js';
import { isPriorityTooLow, submitWithRetry } from '../submit/retry.js';
import { submitStatementOnce } from '../submit/submitStatement.js';
import type { Callback } from '../types.js';

import type { Encryption } from './encyption.js';
import { DecodingError, DecryptionError, UnknownError } from './error.js';
import { toMessage } from './messageMapper.js';
import type { ResponseStatus } from './scale/statementData.js';
import { StatementData } from './scale/statementData.js';
import type { StatementProver } from './statementProver.js';
import type { Filter, Message, RequestMessage, ResponseMessage, Session } from './types.js';

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
  maxRequestSize?: number;
};

const DEFAULT_MAX_REQUEST_SIZE = 4096;

// Rejection reason shared by dispose() and the disposed guards on submit*, so a torn-down session
// always fails new and in-flight work the same way.
const SESSION_DISPOSED = 'Session disposed';

// Bounded retry for transient transport failures (the spec mandates retrying queries
// and submit_statement on connection failure). The TS adapter doesn't expose connection
// state, so we approximate with a short fixed backoff and an attempt cap.
const MAX_INIT_RETRIES = 3;
const MAX_SUBMIT_RETRIES = 3;
const RETRY_DELAY_MS = 25;

/**
 * Fixed per-statement wire overhead reserved before sizing the request payload:
 * topic (32) + channel (32) + expiry (8) + proof signature (64) + signer (32).
 * Mirrors the Android/iOS sessions, which size message batches against
 * `maxStatementSize - overhead` rather than the raw statement limit.
 */
export const STATEMENT_OVERHEAD = 32 + 32 + 8 + 64 + 32; // 168 bytes

type Subscriber = {
  codec: Codec<unknown>;
  callback: Callback<Message<unknown>[]>;
};

type PendingDelivery = {
  resolve(r: ResponseMessage): void;
  reject(e: Error): void;
  promise: Promise<ResponseMessage>;
};

type OutgoingRequest = {
  // Every retransmit appends a fresh id; matching any of them resolves all
  // pending tokens so an early response to a superseded id is not lost.
  requestIds: string[];
  messages: Uint8Array[];
  tokens: string[];
};

type SessionState = {
  phase: 'initialization' | 'active' | 'failed';
  initError: Error | null;
  outgoingRequest: OutgoingRequest | null;
  // Tracks every incoming request by its id with its own responded flag, so an
  // older request stays answerable after a newer one arrives, and an async
  // responder can still ACK the correct id.
  incomingRequests: Map<string, { responded: boolean }>;
  // A queued message can carry several tokens when later identical submissions are
  // deduplicated onto it — they all resolve together when it is finally answered.
  messageQueue: Array<{ encoded: Uint8Array; tokens: string[] }>;
  pendingDelivery: Map<string, PendingDelivery>;
  seenStatements: Set<string>;
};

// Encode/decode a StatementData envelope, surfacing scale-ts throws as a Result.
const encodeStatementData = fromThrowable(StatementData.enc, toError);
const decodeStatementData = fromThrowable(StatementData.dec, toError);

// Outcome of trying to read an incoming statement. `undecodable` carries the requestId when
// it could be recovered from a decrypted-but-malformed payload (so we can NACK the sender).
type DecodeOutcome =
  | { kind: 'decoded'; data: CodecType<typeof StatementData> }
  | { kind: 'undecodable'; requestId: string | null };

// Best-effort recovery of the requestId from a decrypted-but-undecodable payload. The requestId
// is the first field after the enum tag, so it usually survives a corrupt message body. Only
// requests (tag 0) carry an id we should answer; responses (tag 1) and unrecoverable payloads
// return null and are dropped rather than NACKed.
const RequestIdPrefix = Struct({ requestId: str });
const decodeRequestIdPrefix = fromThrowable(
  // slice (a copy), not subarray: scale-ts decodes from the backing buffer start and ignores
  // a view's byteOffset, so a subarray would be read from the wrong position.
  (decrypted: Uint8Array) => RequestIdPrefix.dec(decrypted.slice(1)).requestId,
  () => null,
);
function recoverRequestId(decrypted: Uint8Array): string | null {
  if (decrypted.length < 1 || decrypted[0] !== 0) return null;
  return decodeRequestIdPrefix(decrypted).unwrapOr(null);
}

// nanoid() is fixed-length, so the requestId contributes a constant size; any
// placeholder of that length yields the real encoded size.
const SIZING_REQUEST_ID = 'x'.repeat(21);

// Encoded size of the request payload these messages would occupy in a statement's `data`
// field — the full SCALE envelope (requestId + vector framing), not just the raw bytes. This
// is what must fit the per-statement budget, matching iOS/Android (which size the full payload).
function requestPayloadSize(messages: Uint8Array[]): number {
  return encodeStatementData({ tag: 'request', value: { requestId: SIZING_REQUEST_ID, data: messages } })
    .map(d => d.length)
    .unwrapOr(Number.MAX_SAFE_INTEGER); // unencodable → treat as "doesn't fit"
}

// A response promise paired with its resolver/rejecter. The pre-attached catch
// keeps a clearOutgoingStatement()/dispose() rejection from surfacing as an
// unhandled rejection when no caller awaited it via waitForResponseMessage().
function makeDeferred(): PendingDelivery {
  let resolve!: (r: ResponseMessage) => void;
  let reject!: (e: Error) => void;
  const promise = new Promise<ResponseMessage>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  promise.catch(() => undefined);
  return { resolve, reject, promise };
}

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
  const outgoingSessionId = createSessionId(sessionKey, localAccount, remoteAccount);
  const incomingSessionId = createSessionId(sessionKey, remoteAccount, localAccount);
  // Session-constant channel hashes — derived once so retries don't re-hash them per attempt.
  const requestChannel = createRequestChannel(outgoingSessionId);
  const responseChannel = createResponseChannel(outgoingSessionId);

  // Message bytes must fit within the statement limit minus the fixed wire overhead.
  const maxPayloadSize = Math.max(0, maxRequestSize - STATEMENT_OVERHEAD);

  const state: SessionState = {
    phase: 'initialization',
    initError: null,
    outgoingRequest: null,
    incomingRequests: new Map(),
    messageQueue: [],
    pendingDelivery: new Map(),
    seenStatements: new Set(),
  };

  let subscribers: Subscriber[] = [];
  // Reject callbacks for in-flight waitForRequestMessage() promises, so dispose()
  // can settle them instead of leaving them to hang forever.
  const requestWaiters = new Set<(error: Error) => void>();
  const bufferedMessages: CodecType<typeof StatementData>[] = [];
  let storeUnsub: VoidFunction | null = null;
  let initRetries = 0;
  let initRetryTimer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;
  // Id of the most recent response we initiated (responses share one channel, so only the
  // latest is live — a retry for an older one must not resurrect it).
  let lastResponseRequestId: string | null = null;

  // Encrypt, then submit on `channel`/`topicSessionId` at the allocator's next (strictly
  // increasing) expiry. A priority rejection does NOT resync the allocator here — each caller
  // raises the floor to the chain-reported minimum (the submitWithRetry `onPriorityError` hooks
  // below, and the one-shot clear in clearOutgoingStatement), so the retry — and every later
  // submit — clears it.
  function submitStatementData(
    channel: Uint8Array,
    topicSessionId: SessionId,
    data: Uint8Array,
  ): ResultAsync<void, Error> {
    return encryption.encrypt(data).asyncAndThen(encrypted =>
      submitStatementOnce({
        statementStore,
        prover,
        allocator,
        channel,
        topics: [topicSessionId],
        data: encrypted,
      }),
    );
  }

  // Settle and remove the pending-delivery entries for the given tokens.
  function settleTokens(tokens: string[], settle: (deferred: PendingDelivery) => void): void {
    for (const token of tokens) {
      const deferred = state.pendingDelivery.get(token);
      if (deferred) {
        settle(deferred);
        state.pendingDelivery.delete(token);
      }
    }
  }

  // Session retry policy (this and every submitWithRetry call below): priority errors
  // (ExpiryTooLow / AccountFull) are retried with `priorityAttempts: 'unbounded'` — they never
  // consume the transient-failure budget, because the `onPriorityError` hook raises the allocator
  // floor above the chain-reported minimum, so the next attempt submits higher. We keep at it
  // until the statement lands or the submission is superseded; once superseded, a priority
  // rejection is swallowed as success (it merely lost the channel race to a newer, higher-priority
  // statement). The upshot: priority errors never surface to session callers. Other errors keep
  // the bounded retry and propagate when exhausted. `shouldRetry` is re-checked before each retry:
  // once the submission is superseded, aborted, or the session is disposed it returns false, so a
  // stale retry can never resurrect an old statement.
  function encodeAndSubmitRequest(requestId: string, messages: Uint8Array[]): void {
    encodeStatementData({ tag: 'request', value: { requestId, data: messages } })
      .asyncAndThen(data =>
        submitWithRetry(() => submitStatementData(requestChannel, outgoingSessionId, data), {
          attempts: MAX_SUBMIT_RETRIES,
          priorityAttempts: 'unbounded',
          delaysMs: RETRY_DELAY_MS,
          // Adopt the chain-reported floor so the next attempt submits strictly above it.
          onPriorityError: error => allocator.raiseFloor(error.min),
          // Only keep retrying while this is still the live submission (not superseded by a
          // newer retransmit, aborted via clearOutgoingStatement, or disposed).
          shouldRetry: () => !disposed && state.outgoingRequest?.requestIds.at(-1) === requestId,
        }),
      )
      .mapErr(e => {
        // Priority errors never reach here (see the policy note above), so this is a genuine
        // failure. If this submission was already superseded by a newer retransmit (same tokens)
        // it is not the live request's concern — drop it silently; the newer one carries the
        // waiters. Otherwise the bounded retries are exhausted on the LIVE submission: the
        // request never landed, so fail its waiters rather than let them hang.
        const outgoing = state.outgoingRequest;
        if (disposed || !outgoing || outgoing.requestIds.at(-1) !== requestId) return;
        console.error('submitRequest failed:', e);
        settleTokens(outgoing.tokens, deferred => deferred.reject(e));
        state.outgoingRequest = null;
        processMessageQueue();
      });
  }

  function deliverStatementData(statementData: CodecType<typeof StatementData>): void {
    // Buffer 'request' statements unconditionally so that waitForRequestMessage
    // registered after delivery (race condition) still receives them via subscribe() replay.
    // Buffer everything else during initialization when there are no subscribers yet.
    if (statementData.tag === 'request' || (subscribers.length === 0 && state.phase === 'initialization')) {
      bufferedMessages.push(statementData);
    }

    if (subscribers.length === 0) return;

    for (const sub of subscribers) {
      const messages = toMessage(statementData, sub.codec);
      if (messages.length > 0) sub.callback(messages);
    }
  }

  function tryDecodeStatement(statement: Statement): ResultAsync<DecodeOutcome, never> {
    if (!statement.data) return okAsync({ kind: 'undecodable', requestId: null });
    const data = statement.data;
    return (
      prover
        .verifyMessageProof(statement)
        .andThen(verified => (verified ? ok() : err(new Error('Invalid proof'))))
        .andThen(() => encryption.decrypt(data))
        .map<DecodeOutcome>(decrypted => {
          const decoded = decodeStatementData(decrypted);
          return decoded.isOk()
            ? { kind: 'decoded', data: decoded.value }
            : { kind: 'undecodable', requestId: recoverRequestId(decrypted) };
        })
        // Proof or decryption failure: the payload (incl. the requestId) is unreadable → drop.
        .orElse(() => okAsync<DecodeOutcome, never>({ kind: 'undecodable', requestId: null }))
    );
  }

  function processIncomingStatement(statement: Statement): void {
    if (!statement.data) return;
    const key = toHex(statement.data);
    if (state.seenStatements.has(key)) return;
    state.seenStatements.add(key);

    void tryDecodeStatement(statement).andTee(outcome => {
      if (outcome.kind === 'undecodable') {
        if (outcome.requestId === null) {
          // Proof/decryption failed, or no requestId was recoverable — nothing to NACK.
          console.warn('statement-store: dropping an undecodable incoming statement (no recoverable requestId)');
          return;
        }
        // Only NACK a genuinely new id. If we already know this request, a valid copy is being
        // handled (or was already answered) — NACKing now would mask the real response, since the
        // `responded` flag is sticky.
        if (state.incomingRequests.has(outcome.requestId)) return;
        // Decrypted but the message body is malformed — NACK so the sender stops waiting.
        state.incomingRequests.set(outcome.requestId, { responded: false });
        void session
          .submitResponseMessage(outcome.requestId, 'decodingFailed')
          .mapErr(e => console.error('statement-store: failed to NACK an undecodable request:', e));
        return;
      }

      const statementData = outcome.data;
      if (statementData.tag === 'request') {
        const requestId = statementData.value.requestId;
        if (state.incomingRequests.has(requestId)) return;
        state.incomingRequests.set(requestId, { responded: false });
        deliverStatementData(statementData);
      } else if (statementData.tag === 'response') {
        const outgoing = state.outgoingRequest;
        if (!outgoing?.requestIds.includes(statementData.value.requestId)) return;
        const responseMessage: ResponseMessage = {
          type: 'response',
          localId: statementData.value.requestId,
          requestId: statementData.value.requestId,
          responseCode: statementData.value.responseCode,
        };
        settleTokens(outgoing.tokens, deferred => deferred.resolve(responseMessage));
        state.outgoingRequest = null;
        deliverStatementData(statementData);
        processMessageQueue();
      }
    });
  }

  // Returns true if `encoded` matches a message already in flight or queued, after
  // attaching `token` to it so the caller resolves on that message's response
  // instead of the bytes being submitted a second time.
  function attachToDuplicate(encoded: Uint8Array, token: string): boolean {
    const encodedHex = toHex(encoded);
    const sameBytes = (m: Uint8Array) => m.length === encoded.length && toHex(m) === encodedHex;

    const outgoing = state.outgoingRequest;
    if (outgoing && outgoing.messages.some(sameBytes)) {
      outgoing.tokens.push(token);
      return true;
    }

    const queued = state.messageQueue.find(entry => sameBytes(entry.encoded));
    if (queued) {
      queued.tokens.push(token);
      return true;
    }

    return false;
  }

  function processNewMessage(encoded: Uint8Array, tokens: string[]): void {
    if (state.outgoingRequest === null) {
      const requestId = nanoid();
      state.outgoingRequest = { requestIds: [requestId], messages: [encoded], tokens: [...tokens] };
      encodeAndSubmitRequest(requestId, state.outgoingRequest.messages);
    } else if (requestPayloadSize([...state.outgoingRequest.messages, encoded]) <= maxPayloadSize) {
      state.outgoingRequest.messages.push(encoded);
      state.outgoingRequest.tokens.push(...tokens);
      const newRequestId = nanoid();
      state.outgoingRequest.requestIds.push(newRequestId);
      encodeAndSubmitRequest(newRequestId, state.outgoingRequest.messages);
    } else {
      state.messageQueue.push({ encoded, tokens });
    }
  }

  function processMessageQueue(): void {
    while (state.messageQueue.length > 0) {
      const head = state.messageQueue[0]!;
      // Recompute per iteration; `processNewMessage` mutates outgoingRequest.messages in place.
      if (
        state.outgoingRequest !== null &&
        requestPayloadSize([...state.outgoingRequest.messages, head.encoded]) > maxPayloadSize
      ) {
        break;
      }
      state.messageQueue.shift();
      processNewMessage(head.encoded, head.tokens);
    }
  }

  function ensureStoreSubscription(): void {
    if (storeUnsub) return;
    // A single subscription on the incoming topic carries BOTH the peer's requests
    // and the peer's responses to our requests (the peer publishes everything on its
    // outgoing topic = our incoming topic). We publish on the outgoing topic, which
    // we don't subscribe to, so our own statements are never echoed back.
    storeUnsub = statementStore.subscribeStatements({ matchAll: [incomingSessionId] }, page => {
      for (const statement of page.statements) {
        processIncomingStatement(statement);
      }
    });
  }

  // Once a request is answered it no longer needs to be replayed to future subscribers (and a
  // late waitForRequestMessage must not re-receive an already-handled request). Dropping it also
  // keeps bufferedMessages from growing unboundedly with every incoming request.
  function pruneBufferedRequest(requestId: string): void {
    for (let i = bufferedMessages.length - 1; i >= 0; i--) {
      const sd = bufferedMessages[i];
      if (sd && sd.tag === 'request' && sd.value.requestId === requestId) bufferedMessages.splice(i, 1);
    }
  }

  function rejectAllPending(error: Error): void {
    for (const [, deferred] of state.pendingDelivery) {
      deferred.reject(error);
    }
    state.pendingDelivery.clear();
  }

  function failInit(error: Error): void {
    state.phase = 'failed';
    state.initError = error;
    state.messageQueue = [];
    rejectAllPending(error);
  }

  async function init(): Promise<void> {
    const result = await ResultAsync.combine([
      statementStore.queryStatements({ matchAll: [outgoingSessionId] }),
      statementStore.queryStatements({ matchAll: [incomingSessionId] }),
    ]);

    if (result.isErr()) {
      if (disposed) return;
      // Transient transport failure: retry init (preserving the message queue) before
      // giving up. Only after the cap is reached do we fail terminally.
      if (initRetries < MAX_INIT_RETRIES) {
        initRetries++;
        // Store the handle so dispose() can cancel it — otherwise a disposed session keeps
        // querying and can re-activate itself if a late retry succeeds.
        initRetryTimer = setTimeout(() => {
          initRetryTimer = null;
          void init();
        }, RETRY_DELAY_MS);
        return;
      }
      failInit(result.error);
      return;
    }
    initRetries = 0;

    const [ownStatements, peerStatements] = result.value;

    let maxExpiry = 0n;
    for (const s of ownStatements) {
      if (s.expiry !== undefined && s.expiry > maxExpiry) maxExpiry = s.expiry;
    }
    // Adopt the snapshot's maximum as the allocator floor. raiseFloor is monotonic — the floor
    // never regresses — so a statement submitted while init was in flight (e.g. an auto-ACK for a
    // peer request that arrived during the query) keeps the counter ahead of this snapshot, the
    // same guarantee the old conditional seeding gave. The next submit then draws strictly above
    // the seen on-chain maximum and at least the wall-clock priority, so it cannot collide at an equal expiry.
    allocator.raiseFloor(maxExpiry);

    for (const s of [...ownStatements, ...peerStatements]) {
      if (s.data) state.seenStatements.add(toHex(s.data));
    }

    const decodeAll = (statements: Statement[]) =>
      Promise.all(
        statements.map(s => tryDecodeStatement(s).unwrapOr({ kind: 'undecodable', requestId: null } as DecodeOutcome)),
      ).then(outcomes => outcomes.map(o => (o.kind === 'decoded' ? o.data : null)).filter(nonNullable));

    const [ownDecoded, peerDecoded] = await Promise.all([decodeAll(ownStatements), decodeAll(peerStatements)]);
    if (disposed) return;

    // Both parties publish on their own outgoing topic, so the OUTGOING query returns our
    // requests + OUR responses, and the INCOMING query returns the peer's requests + the
    // PEER's responses. Hence: our request is answered by a PEER response (incoming), and we
    // have answered a peer request iff OUR response (outgoing) carries its id.
    const ownRequest = ownDecoded.find(d => d.tag === 'request');
    const ownResponse = ownDecoded.find(d => d.tag === 'response');
    const peerRequest = peerDecoded.find(d => d.tag === 'request');
    const peerResponse = peerDecoded.find(d => d.tag === 'response');

    if (ownRequest?.tag === 'request') {
      const hasResponse =
        peerResponse?.tag === 'response' && peerResponse.value.requestId === ownRequest.value.requestId;
      if (!hasResponse) {
        state.outgoingRequest = {
          requestIds: [ownRequest.value.requestId],
          messages: ownRequest.value.data,
          tokens: [], // tokens from previous session cannot be restored
        };
      }
    }

    if (peerRequest?.tag === 'request') {
      const requestId = peerRequest.value.requestId;
      // Don't clobber an entry a live delivery may have created during the awaits
      // above (the live one is newer/authoritative).
      if (!state.incomingRequests.has(requestId)) {
        const responded = ownResponse?.tag === 'response' && ownResponse.value.requestId === requestId;
        state.incomingRequests.set(requestId, { responded });
        // Notify app of an unresponded incoming request. Delivered while phase is
        // still 'initialization' so deliverStatementData buffers it for replay if
        // no subscriber is registered yet.
        if (!responded) deliverStatementData(peerRequest);
      }
    }

    state.phase = 'active';
    processMessageQueue();
  }

  const session: Session = {
    request<T>(codec: Codec<T>, data: T) {
      return session
        .submitRequestMessage(codec, data)
        .andThen(({ requestId }) =>
          session.waitForResponseMessage(requestId).andThen(({ responseCode }) => mapResponseCode(responseCode)),
        );
    },

    submitRequestMessage<T>(codec: Codec<T>, message: T) {
      if (disposed) return errAsync(new Error(SESSION_DISPOSED));

      const encode = fromThrowable(codec.enc, toError);
      const encodedResult = encode(message);
      if (encodedResult.isErr()) return errAsync(encodedResult.error);

      const encoded = encodedResult.value;
      if (requestPayloadSize([encoded]) > maxPayloadSize) return errAsync(new Error('message too big'));

      if (state.phase === 'failed') {
        return errAsync(state.initError ?? new Error('Session initialization failed'));
      }

      const token = nanoid();
      state.pendingDelivery.set(token, makeDeferred());

      // Dedup: an identical message already in flight or queued is not re-sent — the
      // new caller is attached to it and resolves on the same response.
      if (!attachToDuplicate(encoded, token)) {
        // FIFO: never let a later (fitting) message overtake queued ones; only append
        // to the live batch when nothing is waiting behind it.
        if (state.phase === 'initialization' || state.messageQueue.length > 0) {
          state.messageQueue.push({ encoded, tokens: [token] });
        } else {
          processNewMessage(encoded, [token]);
        }
      }

      return okAsync({ requestId: token });
    },

    submitResponseMessage(requestId: string, responseCode: ResponseStatus) {
      if (disposed) return errAsync(new Error(SESSION_DISPOSED));
      const incoming = state.incomingRequests.get(requestId);
      if (!incoming) return errAsync(new Error(`No incoming request with id ${requestId}`));
      if (incoming.responded) {
        pruneBufferedRequest(requestId);
        return okAsync(undefined);
      }

      const encoded = encodeStatementData({ tag: 'response', value: { requestId, responseCode } });
      if (encoded.isErr()) return errAsync(encoded.error);

      // Mark responded up-front so concurrent callers dedupe, but roll back if the
      // submission fails — otherwise the ACK is lost forever (and a peer retransmit
      // with a fresh id could never be answered either).
      incoming.responded = true;
      lastResponseRequestId = requestId;
      // Responses go on OUR outgoing topic/response-channel (per spec: the responder
      // publishes on SessionId(self, peer)); the requester reads them from its incoming topic.
      return (
        submitWithRetry(() => submitStatementData(responseChannel, outgoingSessionId, encoded.value), {
          attempts: MAX_SUBMIT_RETRIES,
          priorityAttempts: 'unbounded',
          delaysMs: RETRY_DELAY_MS,
          // Adopt the chain-reported floor so the next attempt submits strictly above it.
          onPriorityError: error => allocator.raiseFloor(error.min),
          // Stop retrying once a newer response supersedes this one (shared response channel) or disposed.
          shouldRetry: () => !disposed && lastResponseRequestId === requestId,
        })
          .orElse(error => {
            // Priority errors never reach here (see the policy note above), so this is a genuine
            // failure. If this is no longer the latest response (superseded) or the session is
            // disposed, keep the request marked answered — re-answering would only clobber the
            // newer response — and absorb the error. NOTE: the shared response channel still only
            // exposes the latest response to the peer, so reliably ACKing several outstanding
            // requests needs the protocol-level fix tracked separately.
            if (disposed || lastResponseRequestId !== requestId) return okAsync<void, Error>(undefined);
            // The live response genuinely failed after exhausting retries — roll back so a later
            // peer retransmit can still be answered, and surface the error.
            incoming.responded = false;
            return errAsync(error);
          })
          // Answered (or absorbed as such): it no longer needs replaying to future subscribers.
          .andTee(() => pruneBufferedRequest(requestId))
      );
    },

    waitForRequestMessage<T, S>(codec: Codec<T>, filter: Filter<T, S>): ResultAsync<S, Error> {
      const promise = new Promise<S>((resolve, reject) => {
        let settled = false;
        // Initialised to a no-op so a synchronous buffered-replay match during
        // subscribe() can call it without hitting the temporal dead zone; the
        // real unsubscribe is wired in once subscribe() returns.
        let unsubscribe: VoidFunction = () => undefined;
        const finish = (run: () => void) => {
          if (settled) return;
          settled = true;
          requestWaiters.delete(rejectWaiter);
          unsubscribe();
          run();
        };
        const rejectWaiter = (error: Error) => finish(() => reject(error));
        requestWaiters.add(rejectWaiter);

        unsubscribe = session.subscribe(codec, messages => {
          for (const message of messages) {
            if (message.type !== 'request') continue;
            if (message.payload.status !== 'parsed') continue;
            const filtered = filter(message.payload.value);
            if (filtered !== undefined) {
              finish(() => resolve(filtered));
              return;
            }
          }
        });

        // subscribe() may have matched synchronously (buffered replay) while
        // `unsubscribe` was still the no-op above — tear down the real one now.
        if (settled) unsubscribe();
      });
      return fromPromise(promise, toError);
    },

    respondToRequests<T>(
      codec: Codec<T>,
      handler: (request: RequestMessage<T>) => ResponseStatus | ResultAsync<ResponseStatus, Error>,
    ) {
      return session.subscribe(codec, messages => {
        for (const message of messages) {
          if (message.type !== 'request') continue;
          const handled = handler(message);
          const statusResult: ResultAsync<ResponseStatus, Error> =
            handled instanceof ResultAsync ? handled : okAsync(handled);
          void statusResult
            .orElse(() => okAsync<ResponseStatus, Error>('unknown'))
            .andThen(code => session.submitResponseMessage(message.requestId, code))
            .mapErr(e => {
              console.error('respondToRequests: failed to submit response:', e);
            });
        }
      });
    },

    waitForResponseMessage(token: string) {
      const deferred = state.pendingDelivery.get(token);
      if (!deferred) return errAsync(new Error(`No pending delivery for token ${token}`));
      return fromPromise(deferred.promise, toError);
    },

    subscribe<T>(codec: Codec<T>, callback: Callback<Message<T>[]>) {
      const sub: Subscriber = {
        codec: codec as Codec<unknown>,
        callback: callback as Callback<Message<unknown>[]>,
      };
      subscribers.push(sub);
      ensureStoreSubscription();

      // Deliver buffered init messages to this subscriber
      if (bufferedMessages.length > 0) {
        const messages = bufferedMessages.flatMap(sd => toMessage(sd, codec));
        if (messages.length > 0) callback(messages);
      }

      return () => {
        subscribers = subscribers.filter(s => s !== sub);
        if (subscribers.length === 0 && storeUnsub) {
          storeUnsub();
          storeUnsub = null;
        }
      };
    },

    clearOutgoingStatement() {
      const outgoing = state.outgoingRequest;

      // Always drop local outgoing state and reject pending waiters up-front,
      // regardless of which path follows. This covers messages queued before the
      // batch went out (e.g. during init, while outgoingRequest is still null) and
      // guarantees cleanup even if the superseding submission below fails — the
      // caller still receives any submission error.
      state.outgoingRequest = null;
      state.messageQueue = [];
      rejectAllPending(new Error('Outgoing batch aborted'));

      if (outgoing === null) return okAsync(undefined);

      const requestId = outgoing.requestIds[outgoing.requestIds.length - 1]!;
      const encoded = encodeStatementData({ tag: 'request', value: { requestId, data: [] } });
      if (encoded.isErr()) return errAsync(encoded.error);

      // Supersede the live batch with an empty one. Use submitStatementData so the
      // empty statement goes out at a STRICTLY higher expiry — the store rejects an
      // equal-or-lower expiry on the same channel, so reusing the last allocated expiry
      // would leave the original request live on-chain. One shot, no retry (clearing is a
      // supersede, not a request that must land); a priority rejection (ExpiryTooLow /
      // AccountFull) means the channel already advanced past us, so the clear already
      // happened → absorb it as success. No retry loop here means no onPriorityError hook, so
      // resync the allocator inline: adopt the chain floor before absorbing, so later submits stay above it.
      return submitStatementData(requestChannel, outgoingSessionId, encoded.value).orElse(error => {
        if (!isPriorityTooLow(error)) return errAsync(error);
        allocator.raiseFloor(error.min);
        return okAsync<void, Error>(undefined);
      });
    },

    dispose() {
      disposed = true;
      if (initRetryTimer) {
        clearTimeout(initRetryTimer);
        initRetryTimer = null;
      }
      storeUnsub?.();
      storeUnsub = null;
      subscribers = [];
      // Drop pending work so no in-flight retry or queue drain acts on a disposed session.
      state.outgoingRequest = null;
      state.messageQueue = [];
      // Settle any waitForRequestMessage() promises so callers unwind instead of
      // hanging forever. Snapshot first — rejecting mutates the set.
      for (const rejectWaiter of [...requestWaiters]) rejectWaiter(new Error(SESSION_DISPOSED));
      requestWaiters.clear();
      rejectAllPending(new Error(SESSION_DISPOSED));
    },
  };

  void init();

  return session;
}

function mapResponseCode(responseCode: ResponseStatus) {
  switch (responseCode) {
    case 'success':
      return ok();
    case 'decodingFailed':
      return err(new DecodingError());
    case 'decryptionFailed':
      return err(new DecryptionError());
    case 'unknown':
      return err(new UnknownError());
  }
}

function createRequestChannel(sessionId: Uint8Array) {
  return khash(sessionId, stringToBytes('request'));
}

function createResponseChannel(sessionId: Uint8Array) {
  return khash(sessionId, stringToBytes('response'));
}
