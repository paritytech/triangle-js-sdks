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
 * Tokens (delivery waiters) are tracked per message rather than per batch, so that a
 * {@link PendingMessageReplacementPolicy} can settle one replaced message without touching
 * the rest of its batch.
 *
 * Deliberate deviation from base-spec.md: `incomingRequests` is a map rather than the
 * spec's single `IncomingRequest(A, B)`. The spec's model assumes the Application Layer
 * answers synchronously; this SDK lets it answer whenever, so an older request has to stay
 * answerable after a newer one arrives. It is local bookkeeping only — the wire is
 * unaffected, since the shared response channel still exposes just the latest response.
 */

import { toHex } from '@novasamatech/scale';

import type { PendingMessageReplacementPolicy } from './replacementPolicy.js';
import type { ResponseStatus } from './scale/statementData.js';

// A message can carry several tokens when later identical (or policy-dropped) submissions
// are attached to it — they all settle together when it is finally answered.
type MessageEntry = { encoded: Uint8Array; tokens: string[] };

type OutgoingRequest = {
  // Every retransmit appends a fresh id; matching any of them resolves all
  // pending tokens so an early response to a superseded id is not lost.
  requestIds: string[];
  entries: MessageEntry[];
};

type IncomingRequest = { responded: boolean };

export type SessionState = {
  phase: 'initialization' | 'active' | 'failed';
  initError: Error | null;
  outgoingRequest: OutgoingRequest | null;
  messageQueue: MessageEntry[];
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
  | { type: 'rejectTokens'; tokens: string[]; error: Error }
  /** These messages were replaced under the replacement policy and will never be sent. */
  | { type: 'replaceTokens'; tokens: string[] };

export type TransitionContext = {
  /** Whether these messages fit one statement — the body builder is the size oracle. */
  fits: (messages: Uint8Array[]) => boolean;
  newRequestId: () => string;
  replacementPolicy: PendingMessageReplacementPolicy;
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

const messagesOf = (entries: MessageEntry[]): Uint8Array[] => entries.map(entry => entry.encoded);
const tokensOf = (entries: MessageEntry[]): string[] => entries.flatMap(entry => entry.tokens);

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && toHex(a) === toHex(b);
}

function addTokens(entries: MessageEntry[], index: number, tokens: string[]): MessageEntry[] {
  return entries.map((entry, i) => (i === index ? { ...entry, tokens: [...entry.tokens, ...tokens] } : entry));
}

function replaceAt(entries: MessageEntry[], index: number, replacement: MessageEntry): MessageEntry[] {
  return entries.map((entry, i) => (i === index ? replacement : entry));
}

function replacedEffects(replaced: MessageEntry | undefined): SessionEffect[] {
  return replaced && replaced.tokens.length > 0 ? [{ type: 'replaceTokens', tokens: replaced.tokens }] : [];
}

/** Give the batch a fresh id and submit it whole — the store keeps one statement per channel. */
function resubmit(state: SessionState, outgoing: OutgoingRequest, ctx: TransitionContext): Transition {
  const requestId = ctx.newRequestId();

  return {
    state: { ...state, outgoingRequest: { ...outgoing, requestIds: [...outgoing.requestIds, requestId] } },
    effects: [{ type: 'submitRequest', requestId, messages: messagesOf(outgoing.entries) }],
  };
}

/**
 * Attach `token` to an identical message already in flight or queued, so the caller
 * resolves on that message's response instead of the bytes going out twice.
 * Returns null when nothing matches.
 */
function attachToDuplicate(state: SessionState, encoded: Uint8Array, token: string): SessionState | null {
  const outgoing = state.outgoingRequest;
  const inBatch = outgoing?.entries.findIndex(entry => sameBytes(entry.encoded, encoded)) ?? -1;
  if (outgoing && inBatch !== -1) {
    return { ...state, outgoingRequest: { ...outgoing, entries: addTokens(outgoing.entries, inBatch, [token]) } };
  }

  // Only the first match takes the token; a later identical entry must not duplicate it.
  const inQueue = state.messageQueue.findIndex(entry => sameBytes(entry.encoded, encoded));
  if (inQueue === -1) return null;

  return { ...state, messageQueue: addTokens(state.messageQueue, inQueue, [token]) };
}

type Slot = { in: 'batch' | 'queue'; index: number };
type Placement = { kind: 'keep' } | { kind: 'drop'; slot: Slot } | { kind: 'replace'; slot: Slot };

/**
 * The policy's verdict for `encoded` against every pending message, batch first. Any
 * `dropNew` wins over a `replacePending`; among replacements the first candidate is taken.
 * A message the policy calls non-replaceable is never compared, so it never displaces or
 * absorbs anything.
 */
function placeAgainst(
  policy: PendingMessageReplacementPolicy,
  encoded: Uint8Array,
  batch: MessageEntry[],
  queue: MessageEntry[],
): Placement {
  if (!policy.isReplaceable(encoded)) return { kind: 'keep' };

  const candidates: { slot: Slot; entry: MessageEntry }[] = [
    ...batch.map((entry, index) => ({ slot: { in: 'batch' as const, index }, entry })),
    ...queue.map((entry, index) => ({ slot: { in: 'queue' as const, index }, entry })),
  ];

  let replace: Slot | null = null;
  for (const { slot, entry } of candidates) {
    const decision = policy.decide(encoded, entry.encoded);
    if (decision === 'dropNew') return { kind: 'drop', slot };
    if (decision === 'replacePending' && replace === null) replace = slot;
  }

  return replace ? { kind: 'replace', slot: replace } : { kind: 'keep' };
}

/**
 * Apply the replacement policy to a newly submitted message. Returns null when the message
 * should be admitted as usual.
 *
 * - drop: the token joins the pending message it duplicates, so the caller's waiter settles
 *   when that message is answered.
 * - replace in the queue: swap in place; nothing has been sent yet.
 * - replace in the live batch: swap and resubmit the whole batch under a fresh id. If the
 *   swapped batch no longer fits, fall back to admitting the message normally.
 *
 * Before activation only the queue is a candidate: nothing may be submitted until the expiry
 * floor is known, and `activated` reconciles the queue with a restored batch.
 */
function applyReplacementPolicy(
  state: SessionState,
  encoded: Uint8Array,
  token: string,
  ctx: TransitionContext,
): Transition | null {
  const outgoing = state.phase === 'active' ? state.outgoingRequest : null;
  const placement = placeAgainst(ctx.replacementPolicy, encoded, outgoing?.entries ?? [], state.messageQueue);
  const entry: MessageEntry = { encoded, tokens: [token] };

  switch (placement.kind) {
    case 'keep':
      return null;

    case 'drop': {
      const { slot } = placement;
      if (slot.in === 'queue')
        return nothing({ ...state, messageQueue: addTokens(state.messageQueue, slot.index, [token]) });
      if (!outgoing) return null;

      return nothing({
        ...state,
        outgoingRequest: { ...outgoing, entries: addTokens(outgoing.entries, slot.index, [token]) },
      });
    }

    case 'replace': {
      const { slot } = placement;
      if (slot.in === 'queue') {
        return {
          state: { ...state, messageQueue: replaceAt(state.messageQueue, slot.index, entry) },
          effects: replacedEffects(state.messageQueue[slot.index]),
        };
      }
      if (!outgoing) return null;

      const entries = replaceAt(outgoing.entries, slot.index, entry);
      if (!ctx.fits(messagesOf(entries))) return null;
      const resubmitted = resubmit(state, { ...outgoing, entries }, ctx);

      return {
        state: resubmitted.state,
        effects: [...replacedEffects(outgoing.entries[slot.index]), ...resubmitted.effects],
      };
    }
  }
}

/**
 * At activation, apply the replacement policy (and byte-dedup) to messages submitted during
 * initialization against the batch restored from the store. Those messages were checked only
 * against each other when submitted, because the restored batch was not known yet.
 *
 * Restored messages carry no tokens — nobody from the previous run is waiting — so a queued
 * message dropped against one takes over waiting for it, and replacing one settles nobody.
 */
function reconcileQueueWithBatch(
  state: SessionState,
  ctx: TransitionContext,
): { transition: Transition; batchChanged: boolean } {
  const outgoing = state.outgoingRequest;
  if (!outgoing || state.messageQueue.length === 0) return { transition: nothing(state), batchChanged: false };

  let entries = outgoing.entries;
  let batchChanged = false;
  const queue: MessageEntry[] = [];
  const effects: SessionEffect[] = [];

  for (const queued of state.messageQueue) {
    const duplicate = entries.findIndex(entry => sameBytes(entry.encoded, queued.encoded));
    if (duplicate !== -1) {
      entries = addTokens(entries, duplicate, queued.tokens);
      continue;
    }

    const placement = placeAgainst(ctx.replacementPolicy, queued.encoded, entries, []);
    if (placement.kind === 'drop') {
      entries = addTokens(entries, placement.slot.index, queued.tokens);
      continue;
    }
    if (placement.kind === 'replace') {
      const swapped = replaceAt(entries, placement.slot.index, queued);
      if (ctx.fits(messagesOf(swapped))) {
        effects.push(...replacedEffects(entries[placement.slot.index]));
        entries = swapped;
        batchChanged = true;
        continue;
      }
    }
    queue.push(queued);
  }

  return {
    transition: { state: { ...state, outgoingRequest: { ...outgoing, entries }, messageQueue: queue }, effects },
    batchChanged,
  };
}

/** Start a batch, extend the live one, or park the message behind it. */
function admit(state: SessionState, entry: MessageEntry, ctx: TransitionContext): Transition {
  const outgoing = state.outgoingRequest;

  if (outgoing === null) {
    const requestId = ctx.newRequestId();

    return {
      state: { ...state, outgoingRequest: { requestIds: [requestId], entries: [entry] } },
      effects: [{ type: 'submitRequest', requestId, messages: [entry.encoded] }],
    };
  }

  const entries = [...outgoing.entries, entry];
  // The statement store keeps one statement per channel, so every submission must
  // carry the FULL unacknowledged batch — an offline peer only ever sees the survivor.
  if (ctx.fits(messagesOf(entries))) return resubmit(state, { ...outgoing, entries }, ctx);

  return { state: { ...state, messageQueue: [...state.messageQueue, entry] }, effects: [] };
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
    if (current.outgoingRequest !== null && !ctx.fits([...messagesOf(current.outgoingRequest.entries), head.encoded]))
      break;

    const admitted = admit({ ...current, messageQueue: rest }, head, ctx);
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

      const replaced = applyReplacementPolicy(state, event.encoded, event.token, ctx);
      if (replaced) return replaced;

      const entry: MessageEntry = { encoded: event.encoded, tokens: [event.token] };
      // FIFO: never let a later (fitting) message overtake queued ones, and never submit
      // before initialization has established the expiry floor.
      if (state.phase === 'initialization' || state.messageQueue.length > 0) {
        return nothing({ ...state, messageQueue: [...state.messageQueue, entry] });
      }

      return admit(state, entry, ctx);
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
            tokens: tokensOf(outgoing.entries),
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
        effects: [{ type: 'rejectTokens', tokens: tokensOf(outgoing.entries), error: event.error }, ...drained.effects],
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
        outgoingRequest: {
          requestIds: [event.requestId],
          entries: event.messages.map(encoded => ({ encoded, tokens: [] })),
        },
      });

    case 'incomingRestored': {
      // Don't clobber an entry a live delivery created while init was still awaiting.
      if (state.incomingRequests.has(event.requestId)) return nothing(state);

      return nothing(withIncoming(state, event.requestId, { responded: event.responded }));
    }

    case 'activated': {
      const reconciled = reconcileQueueWithBatch({ ...state, phase: 'active' }, ctx);
      const drained = drain(reconciled.transition.state, ctx);
      const effects = [...reconciled.transition.effects, ...drained.effects];
      // Draining into the batch already resubmits it whole; only a batch that changed by
      // replacement alone still needs to go out.
      const outgoing = drained.state.outgoingRequest;
      if (!reconciled.batchChanged || !outgoing || effects.some(e => e.type === 'submitRequest')) {
        return { state: drained.state, effects };
      }
      const resubmitted = resubmit(drained.state, outgoing, ctx);

      return { state: resubmitted.state, effects: [...effects, ...resubmitted.effects] };
    }

    case 'initFailed':
      return nothing({ ...state, phase: 'failed', initError: event.error, messageQueue: [] });
  }
}
