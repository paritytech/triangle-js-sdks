/**
 * The session driver: turns the collaborators assembled by `createSession` /
 * `createMultiDeviceSession` into a live {@link Session}.
 *
 * It never branches on single- vs multi-device. Wire format is decided by the injected
 * {@link OutgoingBodyBuilder} and {@link StatementDecoder}; which topics to listen on by
 * the injected {@link IncomingTopics}. Everything here is transport policy that both
 * session kinds share: batching, dedup, the outgoing/incoming request state machine,
 * expiry allocation, retries, and subscriber delivery.
 */

import { toHex } from '@novasamatech/scale';
import type { Statement } from '@novasamatech/sdk-statement';
import { nanoid } from 'nanoid';
import { ResultAsync, err, errAsync, fromPromise, fromThrowable, ok, okAsync } from 'neverthrow';
import type { Codec } from 'scale-ts';

import type { StatementStoreAdapter } from '../adapter/types.js';
import { toError } from '../helpers.js';
import type { SessionId } from '../model/session.js';
import type { ExpiryAllocator } from '../submit/allocator.js';
import { isPriorityTooLow, submitWithRetry } from '../submit/retry.js';
import { submitStatementOnce } from '../submit/submitStatement.js';
import type { Callback } from '../types.js';

import type { IncomingTopicSpec, ReadableEvent, StatementDecoder, TransportEvent } from './codec/decoder.js';
import type { DeviceTarget } from './codec/envelope.js';
import type { IncomingTopics } from './codec/incomingTopics.js';
import type { OutgoingBodyBuilder, StatementBody } from './codec/outgoingBody.js';
import { DecodingError, DecryptionError, UnknownError } from './error.js';
import { toMessage } from './messageMapper.js';
import type { ResponseStatus } from './scale/statementData.js';
import type { StatementProver } from './statementProver.js';
import type { Filter, Message, RequestMessage, ResponseMessage, Session } from './types.js';

/**
 * The Bulletin statement store caps a statement at roughly 500 KiB of total encoded size
 * (proof + channel + topics + expiry + data); 2 KiB leaves margin for the non-data fields.
 * `DataTooLargeError.available` is the chain's authoritative number if this ever drifts.
 *
 * This is deliberately the transport's real capacity rather than an application policy.
 * A too-small budget degrades silently — messages queue instead of batching, with no
 * error — whereas a too-large one fails loudly and recoverably with `DataTooLargeError`.
 * Applications that want a tighter bound (Android's chat uses 100 KiB) should pass their
 * own `maxRequestSize`; base-spec.md leaves the choice to the Application Layer.
 */
export const DEFAULT_MAX_REQUEST_SIZE = 498 * 1024;

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

// nanoid() is fixed-length, so the requestId contributes a constant size; any
// placeholder of that length yields the real encoded size.
const SIZING_REQUEST_ID = 'x'.repeat(21);

// A statement we could neither verify, decrypt, nor decode far enough to answer.
const UNDECODABLE_EVENT: TransportEvent = { tag: 'undecodable', requestId: null };

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

/**
 * Collaborators the driver runs on. `createSession` / `createMultiDeviceSession` assemble
 * these; the driver itself never branches on single- vs multi-device.
 */
export type SessionCoreParams = {
  statementStore: StatementStoreAdapter;
  prover: StatementProver;
  allocator: ExpiryAllocator;
  maxRequestSize: number;
  /** Wire-format writer, and the session's size oracle. */
  bodyBuilder: OutgoingBodyBuilder;
  /** Topic(s) we listen on, with the keys to read each. */
  incomingTopics: IncomingTopics;
  decoder: StatementDecoder;
  /** Topic our own statements are published on — queried to restore state at init. */
  outgoingTopic: SessionId;
  /** Peer devices, for reading back our own multi-device envelopes. Empty when single-device. */
  peerDevices: () => DeviceTarget[];
};

export function createSessionCore({
  statementStore,
  prover,
  allocator,
  maxRequestSize,
  bodyBuilder,
  incomingTopics,
  decoder,
  outgoingTopic,
  peerDevices,
}: SessionCoreParams): Session {
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
  const bufferedMessages: ReadableEvent[] = [];
  // Live topic-set subscription (multi-device rosters change at runtime).
  let topicsUnsub: VoidFunction | null = null;
  let storeUnsub: VoidFunction | null = null;
  let initRetries = 0;
  let initRetryTimer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;
  // Id of the most recent response we initiated (responses share one channel, so only the
  // latest is live — a retry for an older one must not resurrect it).
  let lastResponseRequestId: string | null = null;

  // Submit a body the builder produced, at the allocator's next (strictly increasing)
  // expiry. A priority rejection does NOT resync the allocator here — each caller raises
  // the floor to the chain-reported minimum (the submitWithRetry `onPriorityError` hooks
  // below, and the one-shot clear in clearOutgoingStatement), so the retry — and every
  // later submit — clears it.
  function submitBody(body: StatementBody): ResultAsync<void, Error> {
    return submitStatementOnce({
      statementStore,
      prover,
      allocator,
      channel: body.channel,
      topics: body.topics,
      data: body.data,
    });
  }

  // Encoded size of the statement `data` these messages would occupy — built through the
  // real writer, so AEAD expansion and multi-device envelope fan-out are counted rather
  // than estimated. Unbuildable → treat as "doesn't fit".
  function requestPayloadSize(messages: Uint8Array[]): number {
    return bodyBuilder
      .buildRequest(SIZING_REQUEST_ID, messages)
      .map(body => body.data.length)
      .unwrapOr(Number.MAX_SAFE_INTEGER);
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
    bodyBuilder
      .buildRequest(requestId, messages)
      .asyncAndThen(body =>
        submitWithRetry(() => submitBody(body), {
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

  function deliver(event: ReadableEvent): void {
    // Buffer 'request' events unconditionally so that waitForRequestMessage
    // registered after delivery (race condition) still receives them via subscribe() replay.
    // Buffer everything else during initialization when there are no subscribers yet.
    if (event.tag === 'request' || (subscribers.length === 0 && state.phase === 'initialization')) {
      bufferedMessages.push(event);
    }

    if (subscribers.length === 0) return;

    for (const sub of subscribers) {
      const messages = toMessage(event, sub.codec);
      if (messages.length > 0) sub.callback(messages);
    }
  }

  // Proof or decryption failure leaves the payload (incl. the requestId) unreadable → drop.
  function decodeIncoming(statement: Statement, spec: IncomingTopicSpec): ResultAsync<TransportEvent, never> {
    return decoder
      .decodePeer(statement, spec)
      .orElse(() => okAsync<TransportEvent, never>({ tag: 'undecodable', requestId: null }));
  }

  function processIncomingStatement(statement: Statement, spec: IncomingTopicSpec): void {
    if (!statement.data) return;
    const key = toHex(statement.data);
    if (state.seenStatements.has(key)) return;
    state.seenStatements.add(key);

    void decodeIncoming(statement, spec).andTee(event => {
      if (event.tag === 'undecodable') {
        if (event.requestId === null) {
          // Proof/decryption failed, or no requestId was recoverable — nothing to NACK.
          console.warn('statement-store: dropping an undecodable incoming statement (no recoverable requestId)');
          return;
        }
        // Only NACK a genuinely new id. If we already know this request, a valid copy is being
        // handled (or was already answered) — NACKing now would mask the real response, since the
        // `responded` flag is sticky.
        if (state.incomingRequests.has(event.requestId)) return;
        // Decrypted but the message body is malformed — NACK so the sender stops waiting.
        state.incomingRequests.set(event.requestId, { responded: false });
        void session
          .submitResponseMessage(event.requestId, 'decodingFailed')
          .mapErr(e => console.error('statement-store: failed to NACK an undecodable request:', e));
        return;
      }

      if (event.tag === 'request') {
        if (state.incomingRequests.has(event.requestId)) return;
        state.incomingRequests.set(event.requestId, { responded: false });
        deliver(event);
      } else {
        const outgoing = state.outgoingRequest;
        if (!outgoing?.requestIds.includes(event.requestId)) return;
        const responseMessage: ResponseMessage = {
          type: 'response',
          localId: event.requestId,
          requestId: event.requestId,
          responseCode: event.responseCode,
        };
        settleTokens(outgoing.tokens, deferred => deferred.resolve(responseMessage));
        state.outgoingRequest = null;
        deliver(event);
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

  // Find the spec whose topic a statement arrived on, so the right sender key is used to
  // open it. Single-topic sessions short-circuit — the store already filtered for us.
  function specForStatement(specs: IncomingTopicSpec[], statement: Statement): IncomingTopicSpec | undefined {
    if (specs.length <= 1) return specs[0];
    const topics = statement.topics ?? [];

    return specs.find(spec => {
      const specHex = toHex(spec.topic);

      return topics.some(topic => (typeof topic === 'string' ? topic : toHex(topic)) === specHex);
    });
  }

  // ONE subscription covering every incoming topic. A peer's requests AND its responses to
  // our requests both arrive here (the peer publishes everything on its outgoing topic =
  // our incoming topic). We publish on our own outgoing topic, which we don't subscribe to,
  // so our statements are never echoed back.
  function openStoreSubscription(specs: IncomingTopicSpec[]): void {
    storeUnsub?.();
    storeUnsub =
      specs.length === 0
        ? null
        : statementStore.subscribeStatements({ matchAny: specs.map(spec => spec.topic) }, page => {
            for (const statement of page.statements) {
              const spec = specForStatement(specs, statement);
              if (spec) processIncomingStatement(statement, spec);
            }
          });
  }

  function ensureStoreSubscription(): void {
    if (topicsUnsub) return;
    openStoreSubscription(incomingTopics.current());
    // A roster change (peer device added/removed) changes the topic set — re-open the
    // single subscription rather than accumulating one per device.
    topicsUnsub = incomingTopics.subscribe(specs => {
      if (disposed) return;
      openStoreSubscription(specs);
    });
  }

  // Once a request is answered it no longer needs to be replayed to future subscribers (and a
  // late waitForRequestMessage must not re-receive an already-handled request). Dropping it also
  // keeps bufferedMessages from growing unboundedly with every incoming request.
  function pruneBufferedRequest(requestId: string): void {
    for (let i = bufferedMessages.length - 1; i >= 0; i--) {
      const buffered = bufferedMessages[i];
      if (buffered?.tag === 'request' && buffered.requestId === requestId) bufferedMessages.splice(i, 1);
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
    const specs = incomingTopics.current();
    const result = await ResultAsync.combine([
      statementStore.queryStatements({ matchAll: [outgoingTopic] }),
      statementStore.queryStatements({ matchAny: specs.map(spec => spec.topic) }),
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

    const isReadable = (event: TransportEvent) => event.tag !== 'undecodable';
    // Our own statements are read back with `decodeOwn` — a multi-device envelope carries no
    // entry for us, so it is opened via a recipient device we wrapped it for. This is what
    // lets the store, rather than a client-side outbox, hold the outgoing-request state.
    const decodeOwnAll = Promise.all(
      ownStatements.map(s => decoder.decodeOwn(s, peerDevices()).unwrapOr(UNDECODABLE_EVENT)),
    ).then(events => events.filter(isReadable));
    const decodePeerAll = Promise.all(
      peerStatements.map(s => {
        const spec = specForStatement(specs, s);

        return spec ? decodeIncoming(s, spec).unwrapOr(UNDECODABLE_EVENT) : Promise.resolve(UNDECODABLE_EVENT);
      }),
    ).then(events => events.filter(isReadable));

    const [ownDecoded, peerDecoded] = await Promise.all([decodeOwnAll, decodePeerAll]);
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
      const hasResponse = peerResponse?.tag === 'response' && peerResponse.requestId === ownRequest.requestId;
      if (!hasResponse) {
        state.outgoingRequest = {
          requestIds: [ownRequest.requestId],
          messages: ownRequest.messages,
          tokens: [], // tokens from previous session cannot be restored
        };
      }
    }

    if (peerRequest?.tag === 'request') {
      const requestId = peerRequest.requestId;
      // Don't clobber an entry a live delivery may have created during the awaits
      // above (the live one is newer/authoritative).
      if (!state.incomingRequests.has(requestId)) {
        const responded = ownResponse?.tag === 'response' && ownResponse.requestId === requestId;
        state.incomingRequests.set(requestId, { responded });
        // Notify app of an unresponded incoming request. Delivered while phase is
        // still 'initialization' so `deliver` buffers it for replay if no subscriber
        // is registered yet.
        if (!responded) deliver(peerRequest);
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

      const body = bodyBuilder.buildResponse(requestId, responseCode);
      if (body.isErr()) return errAsync(body.error);
      const responseBody = body.value;

      // Mark responded up-front so concurrent callers dedupe, but roll back if the
      // submission fails — otherwise the ACK is lost forever (and a peer retransmit
      // with a fresh id could never be answered either).
      incoming.responded = true;
      lastResponseRequestId = requestId;
      // Responses go on OUR outgoing topic/response-channel (per spec: the responder
      // publishes on SessionId(self, peer)); the requester reads them from its incoming topic.
      return (
        submitWithRetry(() => submitBody(responseBody), {
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
      const emptyBody = bodyBuilder.buildRequest(requestId, []);
      if (emptyBody.isErr()) return errAsync(emptyBody.error);

      // Supersede the live batch with an empty one, which goes out at a STRICTLY higher
      // expiry — the store rejects an equal-or-lower expiry on the same channel, so reusing
      // the last allocated expiry would leave the original request live on-chain. One shot,
      // no retry (clearing is a supersede, not a request that must land); a priority
      // rejection (ExpiryTooLow / AccountFull) means the channel already advanced past us,
      // so the clear already happened → absorb it as success. No retry loop here means no
      // onPriorityError hook, so resync the allocator inline: adopt the chain floor before
      // absorbing, so later submits stay above it.
      return submitBody(emptyBody.value).orElse(error => {
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
      topicsUnsub?.();
      topicsUnsub = null;
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
