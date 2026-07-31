/**
 * The session's transport decision logic as a pure reducer: {@link transition} maps a
 * {@link SessionState} and a {@link SessionEvent} to the next state plus the
 * {@link SessionEffect}s the driver must perform. It performs no I/O, mutates nothing it is
 * given, and reads no clock — sizing and id generation arrive in {@link TransitionContext},
 * so tests make both deterministic.
 *
 * The state is what base-spec.md §"Session State" defines: the phase, the outgoing request
 * plus the queue behind it, and the incoming requests.
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

type IncomingRequest = { responded: boolean };

export type SessionState = {
  phase: 'initialization' | 'active' | 'failed';
  initError: Error | null;
  outgoingRequest: OutgoingRequest | null;
  // A queued message can carry several tokens when later identical submissions are
  // deduplicated onto it — they all resolve together when it is finally answered.
  messageQueue: QueuedMessage[];
  incomingRequests: Map<string, IncomingRequest>;
};

export type SessionEvent =
  /** The application layer wants a message sent. */
  | { type: 'messageSubmitted'; encoded: Uint8Array; token: string }
  /** A peer request we had not seen before. */
  | { type: 'requestReceived'; requestId: string }
  /** A peer response arrived on our outgoing batch. */
  | { type: 'responseReceived'; requestId: string; responseCode: ResponseStatus }
  /** A request submission exhausted its retries. */
  | { type: 'requestSubmitFailed'; requestId: string; error: Error }
  /** We answered an incoming request (marked before the submit, so concurrent callers dedupe). */
  | { type: 'responseSubmitted'; requestId: string }
  /** That answer failed after retries — let a later peer retransmit be answered. */
  | { type: 'responseSubmitFailed'; requestId: string }
  /**
   * The statement budget may now hold a different number of messages — the peer's device
   * roster changed, so the envelope grew or shrank. Re-evaluate what the queue can ship.
   */
  | { type: 'capacityChanged' }
  /** Drop the live batch and everything queued behind it. */
  | { type: 'outgoingCleared' }
  /** An unacknowledged batch was found in the store during initialization. */
  | { type: 'outgoingRestored'; requestId: string; messages: Uint8Array[] }
  /** An incoming request was found in the store during initialization. */
  | { type: 'incomingRestored'; requestId: string; responded: boolean }
  /** Initialization finished: go active and ship whatever the queue held. */
  | { type: 'activated' }
  /** Initialization failed terminally. */
  | { type: 'initFailed'; error: Error };

/** Work the driver must carry out. The reducer performs none of it. */
export type SessionEffect =
  | { type: 'submitRequest'; requestId: string; messages: Uint8Array[] }
  | { type: 'resolveTokens'; tokens: string[]; requestId: string; responseCode: ResponseStatus }
  | { type: 'rejectTokens'; tokens: string[]; error: Error };

export type TransitionContext = {
  /** Whether these messages fit one statement — the body builder is the size oracle. */
  fits: (messages: Uint8Array[]) => boolean;
  newRequestId: () => string;
};

export type Transition = { state: SessionState; effects: SessionEffect[] };

export function initialSessionState(): SessionState {
  return {
    phase: 'initialization',
    initError: null,
    outgoingRequest: null,
    messageQueue: [],
    incomingRequests: new Map(),
  };
}

// ── selectors ────────────────────────────────────────────────────────────────
// Reads the driver needs that are not transitions.

export function incomingRequest(state: SessionState, requestId: string): IncomingRequest | undefined {
  return state.incomingRequests.get(requestId);
}

/**
 * The newest submission of the live batch: the id still worth retrying, and the one whose
 * on-chain statement must be superseded to clear the batch. Null when nothing is in flight.
 */
export function liveRequestId(state: SessionState): string | null {
  return state.outgoingRequest?.requestIds.at(-1) ?? null;
}

// ── internals ────────────────────────────────────────────────────────────────

const nothing = (state: SessionState): Transition => ({ state, effects: [] });

function withIncoming(state: SessionState, requestId: string, value: IncomingRequest): SessionState {
  return { ...state, incomingRequests: new Map(state.incomingRequests).set(requestId, value) };
}

/**
 * Attach `token` to an identical message already in flight or queued, so the caller
 * resolves on that message's response instead of the bytes going out twice.
 * Returns null when nothing matches.
 */
function attachToDuplicate(state: SessionState, encoded: Uint8Array, token: string): SessionState | null {
  const encodedHex = toHex(encoded);
  const sameBytes = (m: Uint8Array) => m.length === encoded.length && toHex(m) === encodedHex;

  const outgoing = state.outgoingRequest;
  if (outgoing?.messages.some(sameBytes)) {
    return { ...state, outgoingRequest: { ...outgoing, tokens: [...outgoing.tokens, token] } };
  }

  // Only the first match takes the token; a later identical entry must not duplicate it.
  const index = state.messageQueue.findIndex(entry => sameBytes(entry.encoded));
  if (index === -1) return null;

  return {
    ...state,
    messageQueue: state.messageQueue.map((entry, i) =>
      i === index ? { ...entry, tokens: [...entry.tokens, token] } : entry,
    ),
  };
}

/** Start a batch, extend the live one, or park the message behind it. */
function admit(state: SessionState, encoded: Uint8Array, tokens: string[], ctx: TransitionContext): Transition {
  const outgoing = state.outgoingRequest;

  if (outgoing === null) {
    const requestId = ctx.newRequestId();
    const messages = [encoded];

    return {
      state: { ...state, outgoingRequest: { requestIds: [requestId], messages, tokens: [...tokens] } },
      effects: [{ type: 'submitRequest', requestId, messages: [...messages] }],
    };
  }

  const messages = [...outgoing.messages, encoded];
  if (ctx.fits(messages)) {
    const requestId = ctx.newRequestId();

    return {
      state: {
        ...state,
        outgoingRequest: {
          requestIds: [...outgoing.requestIds, requestId],
          messages,
          tokens: [...outgoing.tokens, ...tokens],
        },
      },
      // The statement store keeps one statement per channel, so every submission must
      // carry the FULL unacknowledged batch — an offline peer only ever sees the survivor.
      effects: [{ type: 'submitRequest', requestId, messages: [...messages] }],
    };
  }

  return { state: { ...state, messageQueue: [...state.messageQueue, { encoded, tokens }] }, effects: [] };
}

/**
 * Move queue heads into the batch for as long as the budget allows. FIFO: a later message
 * never overtakes one already waiting.
 */
function drain(state: SessionState, ctx: TransitionContext): Transition {
  let current = state;
  const effects: SessionEffect[] = [];

  while (current.messageQueue.length > 0) {
    const [head, ...rest] = current.messageQueue;
    if (!head) break;
    // Recomputed per iteration; `admit` grows the batch as it goes.
    if (current.outgoingRequest !== null && !ctx.fits([...current.outgoingRequest.messages, head.encoded])) break;

    const admitted = admit({ ...current, messageQueue: rest }, head.encoded, head.tokens, ctx);
    current = admitted.state;
    effects.push(...admitted.effects);
  }

  return { state: current, effects };
}

// ── reducer ──────────────────────────────────────────────────────────────────

export function transition(state: SessionState, event: SessionEvent, ctx: TransitionContext): Transition {
  switch (event.type) {
    case 'messageSubmitted': {
      const deduped = attachToDuplicate(state, event.encoded, event.token);
      if (deduped) return nothing(deduped);

      // FIFO: never let a later (fitting) message overtake queued ones, and never submit
      // before initialization has established the expiry floor.
      if (state.phase === 'initialization' || state.messageQueue.length > 0) {
        return nothing({
          ...state,
          messageQueue: [...state.messageQueue, { encoded: event.encoded, tokens: [event.token] }],
        });
      }

      return admit(state, event.encoded, [event.token], ctx);
    }

    case 'requestReceived': {
      if (state.incomingRequests.has(event.requestId)) return nothing(state);

      return nothing(withIncoming(state, event.requestId, { responded: false }));
    }

    case 'responseReceived': {
      const outgoing = state.outgoingRequest;
      // Any id the batch was ever submitted under counts — an early response to a
      // superseded retransmit still answers the same messages.
      if (!outgoing?.requestIds.includes(event.requestId)) return nothing(state);

      const drained = drain({ ...state, outgoingRequest: null }, ctx);

      return {
        state: drained.state,
        effects: [
          {
            type: 'resolveTokens',
            tokens: outgoing.tokens,
            requestId: event.requestId,
            responseCode: event.responseCode,
          },
          ...drained.effects,
        ],
      };
    }

    case 'requestSubmitFailed': {
      const outgoing = state.outgoingRequest;
      // Superseded by a newer retransmit carrying the same tokens — that one owns the
      // waiters now, so this failure is not the live batch's concern.
      if (!outgoing || outgoing.requestIds.at(-1) !== event.requestId) return nothing(state);

      const drained = drain({ ...state, outgoingRequest: null }, ctx);

      return {
        state: drained.state,
        effects: [{ type: 'rejectTokens', tokens: outgoing.tokens, error: event.error }, ...drained.effects],
      };
    }

    case 'responseSubmitted': {
      const incoming = state.incomingRequests.get(event.requestId);
      if (!incoming) return nothing(state);

      return nothing(withIncoming(state, event.requestId, { responded: true }));
    }

    case 'responseSubmitFailed': {
      const incoming = state.incomingRequests.get(event.requestId);
      if (!incoming) return nothing(state);

      return nothing(withIncoming(state, event.requestId, { responded: false }));
    }

    case 'capacityChanged':
      // Never before initialization has established the expiry floor; `activated` drains.
      return state.phase === 'active' ? drain(state, ctx) : nothing(state);

    case 'outgoingCleared':
      return nothing({ ...state, outgoingRequest: null, messageQueue: [] });

    case 'outgoingRestored':
      return nothing({
        ...state,
        // Tokens from a previous run cannot be restored — nobody is awaiting them.
        outgoingRequest: { requestIds: [event.requestId], messages: event.messages, tokens: [] },
      });

    case 'incomingRestored': {
      // Don't clobber an entry a live delivery created while init was still awaiting.
      if (state.incomingRequests.has(event.requestId)) return nothing(state);

      return nothing(withIncoming(state, event.requestId, { responded: event.responded }));
    }

    case 'activated':
      return drain({ ...state, phase: 'active' }, ctx);

    case 'initFailed':
      return nothing({ ...state, phase: 'failed', initError: event.error, messageQueue: [] });
  }
}
