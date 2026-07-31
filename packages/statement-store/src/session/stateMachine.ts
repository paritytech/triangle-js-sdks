/**
 * The session's transport decision logic, with no I/O in it.
 *
 * Owns the three pieces of state base-spec.md §"Session State" defines — the session phase,
 * the outgoing request plus its message queue, and the incoming requests — and answers the
 * only questions that actually require judgement:
 *
 *  - does this message start a new batch, extend the live one, or wait in the queue?
 *  - is this an exact duplicate of something already in flight?
 *  - does this response/failure belong to the batch that is still live?
 *  - what can be drained now that the budget freed up?
 *
 * It never submits, encrypts, subscribes or settles a promise. Instead every method returns
 * {@link SessionEffect}s for the driver to perform. Sizing (`fits`) and id generation
 * (`newRequestId`) are injected, so the whole module is deterministic and testable without
 * a statement store.
 *
 * Deliberate deviation from base-spec.md: `incomingRequests` is a map rather than the
 * spec's single `IncomingRequest(A, B)`. The spec's model assumes the Application Layer
 * answers synchronously; this SDK lets it answer whenever, so an older request has to stay
 * answerable after a newer one arrives. It is local bookkeeping only — the wire is
 * unaffected, since the shared response channel still exposes just the latest response.
 */

import { toHex } from '@novasamatech/scale';

import type { ResponseStatus } from './scale/statementData.js';

type QueuedMessage = { encoded: Uint8Array; tokens: string[] };

type OutgoingRequest = {
  // Every retransmit appends a fresh id; matching any of them resolves all
  // pending tokens so an early response to a superseded id is not lost.
  requestIds: string[];
  messages: Uint8Array[];
  tokens: string[];
};

type SessionPhase = 'initialization' | 'active' | 'failed';

/** Work the driver must carry out. The machine itself performs none of it. */
export type SessionEffect =
  | { type: 'submitRequest'; requestId: string; messages: Uint8Array[] }
  | { type: 'resolveTokens'; tokens: string[]; requestId: string; responseCode: ResponseStatus }
  | { type: 'rejectTokens'; tokens: string[]; error: Error };

type IncomingRequestState = { responded: boolean };

export type SessionStateMachine = {
  phase(): SessionPhase;
  initError(): Error | null;

  /** Accept a message from the application layer. */
  submitMessage(encoded: Uint8Array, token: string): SessionEffect[];
  /** True while `requestId` is the newest submission of the live batch. */
  isLiveRequest(requestId: string): boolean;
  onResponse(requestId: string, responseCode: ResponseStatus): SessionEffect[];
  onSubmitFailed(requestId: string, error: Error): SessionEffect[];
  /**
   * Drop the live batch and everything queued behind it. Returns the request id whose
   * statement must be superseded on-chain, or null when nothing was in flight.
   */
  clearOutgoing(): string | null;

  /** Restore an unacknowledged batch found in the store during initialization. */
  restoreOutgoing(requestId: string, messages: Uint8Array[]): void;
  /** Register an incoming request seen during initialization, with its answered state. */
  restoreIncoming(requestId: string, responded: boolean): void;
  /** Enter the active phase and drain whatever the queue held during initialization. */
  activate(): SessionEffect[];
  failInit(error: Error): void;

  /** Start tracking a newly seen incoming request. False when it was already known. */
  trackIncoming(requestId: string): boolean;
  incoming(requestId: string): IncomingRequestState | undefined;

  /** Snapshot for the disposed/aborted paths: every token still awaiting a response. */
  pendingTokens(): string[];
};

export function createSessionStateMachine({
  fits,
  newRequestId,
}: {
  /** Whether these messages fit one statement — the body builder is the size oracle. */
  fits: (messages: Uint8Array[]) => boolean;
  newRequestId: () => string;
}): SessionStateMachine {
  let phase: SessionPhase = 'initialization';
  let initError: Error | null = null;
  let outgoingRequest: OutgoingRequest | null = null;
  let messageQueue: QueuedMessage[] = [];
  const incomingRequests = new Map<string, IncomingRequestState>();

  // Attach `token` to an identical message already in flight or queued, so the caller
  // resolves on that message's response instead of the bytes going out twice.
  function attachToDuplicate(encoded: Uint8Array, token: string): boolean {
    const encodedHex = toHex(encoded);
    const sameBytes = (m: Uint8Array) => m.length === encoded.length && toHex(m) === encodedHex;

    if (outgoingRequest?.messages.some(sameBytes)) {
      outgoingRequest.tokens.push(token);

      return true;
    }

    const queued = messageQueue.find(entry => sameBytes(entry.encoded));
    if (queued) {
      queued.tokens.push(token);

      return true;
    }

    return false;
  }

  // Start a batch, extend the live one, or park the message behind it.
  function admit(encoded: Uint8Array, tokens: string[]): SessionEffect[] {
    if (outgoingRequest === null) {
      const requestId = newRequestId();
      outgoingRequest = { requestIds: [requestId], messages: [encoded], tokens: [...tokens] };

      // Snapshot: the live array keeps growing as later messages join the batch.
      return [{ type: 'submitRequest', requestId, messages: [...outgoingRequest.messages] }];
    }

    if (fits([...outgoingRequest.messages, encoded])) {
      outgoingRequest.messages.push(encoded);
      outgoingRequest.tokens.push(...tokens);
      const requestId = newRequestId();
      outgoingRequest.requestIds.push(requestId);

      return [{ type: 'submitRequest', requestId, messages: [...outgoingRequest.messages] }];
    }

    messageQueue.push({ encoded, tokens });

    return [];
  }

  // Move queue heads into the batch for as long as the budget allows. FIFO: a later
  // message never overtakes one already waiting.
  function drain(): SessionEffect[] {
    const effects: SessionEffect[] = [];
    while (messageQueue.length > 0) {
      const head = messageQueue[0]!;
      // Recomputed per iteration; `admit` grows the batch in place.
      if (outgoingRequest !== null && !fits([...outgoingRequest.messages, head.encoded])) break;
      messageQueue.shift();
      effects.push(...admit(head.encoded, head.tokens));
    }

    return effects;
  }

  return {
    phase: () => phase,
    initError: () => initError,

    submitMessage(encoded, token) {
      if (attachToDuplicate(encoded, token)) return [];

      // FIFO: never let a later (fitting) message overtake queued ones, and never submit
      // before initialization has established the expiry floor.
      if (phase === 'initialization' || messageQueue.length > 0) {
        messageQueue.push({ encoded, tokens: [token] });

        return [];
      }

      return admit(encoded, [token]);
    },

    isLiveRequest(requestId) {
      return outgoingRequest?.requestIds.at(-1) === requestId;
    },

    onResponse(requestId, responseCode) {
      const outgoing = outgoingRequest;
      // Any id the batch was ever submitted under counts — an early response to a
      // superseded retransmit still answers the same messages.
      if (!outgoing?.requestIds.includes(requestId)) return [];

      outgoingRequest = null;

      return [{ type: 'resolveTokens', tokens: outgoing.tokens, requestId, responseCode }, ...drain()];
    },

    onSubmitFailed(requestId, error) {
      const outgoing = outgoingRequest;
      // Superseded by a newer retransmit carrying the same tokens — that one owns the
      // waiters now, so this failure is not the live batch's concern.
      if (!outgoing || outgoing.requestIds.at(-1) !== requestId) return [];

      outgoingRequest = null;

      return [{ type: 'rejectTokens', tokens: outgoing.tokens, error }, ...drain()];
    },

    clearOutgoing() {
      const outgoing = outgoingRequest;
      outgoingRequest = null;
      messageQueue = [];

      return outgoing?.requestIds.at(-1) ?? null;
    },

    restoreOutgoing(requestId, messages) {
      // Tokens from a previous run cannot be restored — nobody is awaiting them.
      outgoingRequest = { requestIds: [requestId], messages, tokens: [] };
    },

    restoreIncoming(requestId, responded) {
      // Don't clobber an entry a live delivery created while init was still awaiting.
      if (incomingRequests.has(requestId)) return;
      incomingRequests.set(requestId, { responded });
    },

    activate() {
      phase = 'active';

      return drain();
    },

    failInit(error) {
      phase = 'failed';
      initError = error;
      messageQueue = [];
    },

    trackIncoming(requestId) {
      if (incomingRequests.has(requestId)) return false;
      incomingRequests.set(requestId, { responded: false });

      return true;
    },

    incoming(requestId) {
      return incomingRequests.get(requestId);
    },

    pendingTokens() {
      return [...(outgoingRequest?.tokens ?? []), ...messageQueue.flatMap(entry => entry.tokens)];
    },
  };
}
