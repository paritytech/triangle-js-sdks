import { describe, expect, it } from 'vitest';

import type { SessionEffect, SessionEvent, SessionState, TransitionContext } from './stateMachine.js';
import { incomingRequest, initialSessionState, liveRequestId, transition } from './stateMachine.js';

const msg = (text: string) => new TextEncoder().encode(text);

/**
 * `fits` counts messages rather than bytes, so a test can say "two per statement" and read
 * as the batching rule it exercises. Ids are sequential for the same reason.
 */
function makeContext({ capacity = Infinity }: { capacity?: number } = {}): TransitionContext {
  let next = 0;

  return {
    fits: messages => messages.length <= capacity,
    newRequestId: () => `r${(++next).toString()}`,
  };
}

/** Fold a sequence of events, keeping only the effects of the LAST one. */
function run(
  events: SessionEvent[],
  opts: { capacity?: number; from?: SessionState } = {},
): { state: SessionState; effects: SessionEffect[] } {
  const ctx = makeContext(opts);
  let state = opts.from ?? initialSessionState();
  let effects: SessionEffect[] = [];

  for (const event of events) {
    const result = transition(state, event, ctx);
    state = result.state;
    effects = result.effects;
  }

  return { state, effects };
}

const send = (text: string, token: string): SessionEvent => ({
  type: 'messageSubmitted',
  encoded: msg(text),
  token,
});

const ACTIVATE: SessionEvent = { type: 'activated' };
const submits = (effects: SessionEffect[]) => effects.filter(e => e.type === 'submitRequest');

describe('session state machine', () => {
  it('never mutates the state it is given', () => {
    const before = initialSessionState();
    const snapshot = { ...before, messageQueue: [...before.messageQueue] };

    transition(before, send('a', 't1'), makeContext());

    expect(before.messageQueue).toEqual(snapshot.messageQueue);
    expect(before.outgoingRequest).toBeNull();
  });

  describe('phase', () => {
    it('queues instead of submitting while initializing', () => {
      const { state, effects } = run([send('a', 't1')]);

      expect(state.phase).toBe('initialization');
      expect(effects).toEqual([]);
    });

    it('drains what initialization queued once active', () => {
      const { effects } = run([send('a', 't1'), send('b', 't2'), ACTIVATE]);

      // Both ride one batch: the second extends the first, so the latest submission
      // carries everything unacknowledged.
      expect(submits(effects).at(-1)).toMatchObject({ messages: [msg('a'), msg('b')] });
    });

    it('records a terminal initialization failure', () => {
      const error = new Error('init failed');
      const { state } = run([send('a', 't1'), { type: 'initFailed', error }]);

      expect(state.phase).toBe('failed');
      expect(state.initError).toBe(error);
      expect(state.messageQueue).toEqual([]);
    });
  });

  describe('batching', () => {
    it('submits the first message immediately', () => {
      const { effects } = run([ACTIVATE, send('a', 't1')]);

      expect(effects).toEqual([{ type: 'submitRequest', requestId: 'r1', messages: [msg('a')] }]);
    });

    // The store keeps one statement per channel, so each submission must carry every
    // message the peer has not acknowledged — not just the newest one.
    it('resubmits the whole unacknowledged batch when extending it', () => {
      const { effects } = run([ACTIVATE, send('a', 't1'), send('b', 't2')]);

      expect(effects).toEqual([{ type: 'submitRequest', requestId: 'r2', messages: [msg('a'), msg('b')] }]);
    });

    it('queues a message that does not fit the live batch', () => {
      const { state, effects } = run([ACTIVATE, send('a', 't1'), send('b', 't2')], { capacity: 1 });

      expect(effects).toEqual([]);
      expect(state.messageQueue).toHaveLength(1);
    });

    it('keeps FIFO: a later fitting message never overtakes a queued one', () => {
      const events = [ACTIVATE, send('a', 't1'), send('b', 't2'), send('c', 't3'), send('d', 't4')];
      // Batch holds a+b; c and d both wait, even though d alone would fit.
      const { state } = run(events, { capacity: 2 });
      expect(state.messageQueue.map(e => e.tokens)).toEqual([['t3'], ['t4']]);

      const { effects } = run([...events, { type: 'responseReceived', requestId: 'r2', responseCode: 'success' }], {
        capacity: 2,
      });
      expect(submits(effects).at(-1)).toMatchObject({ messages: [msg('c'), msg('d')] });
    });

    it('snapshots the messages of each submission', () => {
      const ctx = makeContext();
      let state = transition(initialSessionState(), ACTIVATE, ctx).state;

      const first = transition(state, send('a', 't1'), ctx);
      state = first.state;
      transition(state, send('b', 't2'), ctx);

      // The earlier effect must not have grown along with the batch.
      expect(first.effects).toEqual([{ type: 'submitRequest', requestId: 'r1', messages: [msg('a')] }]);
    });
  });

  describe('deduplication', () => {
    it('attaches a duplicate of an in-flight message instead of resending', () => {
      const events = [ACTIVATE, send('a', 't1'), send('a', 't2')];

      expect(run(events).effects).toEqual([]);

      // Both tokens resolve on the one response.
      const { effects } = run([...events, { type: 'responseReceived', requestId: 'r1', responseCode: 'success' }]);
      expect(effects[0]).toMatchObject({ type: 'resolveTokens', tokens: ['t1', 't2'] });
    });

    it('attaches a duplicate of a queued message', () => {
      const events = [ACTIVATE, send('a', 't1'), send('b', 't2'), send('b', 't3')];
      const { state } = run(events, { capacity: 1 });

      expect(state.messageQueue).toHaveLength(1);
      expect(state.messageQueue[0]!.tokens).toEqual(['t2', 't3']);
    });

    it('gives the token to only one of two identical queued entries', () => {
      // Two distinct queue entries can hold the same bytes when the first was queued
      // before the second's dedup check could see it.
      const seeded: SessionState = {
        ...initialSessionState(),
        phase: 'active',
        outgoingRequest: { requestIds: ['r0'], messages: [msg('x')], tokens: ['t0'] },
        messageQueue: [
          { encoded: msg('dup'), tokens: ['t1'] },
          { encoded: msg('dup'), tokens: ['t2'] },
        ],
      };

      const { state } = run([send('dup', 't3')], { capacity: 1, from: seeded });

      expect(state.messageQueue.map(e => e.tokens)).toEqual([['t1', 't3'], ['t2']]);
    });
  });

  describe('responses', () => {
    it('resolves the batch tokens and drains the queue', () => {
      const { effects } = run(
        [
          ACTIVATE,
          send('a', 't1'),
          send('b', 't2'),
          { type: 'responseReceived', requestId: 'r1', responseCode: 'success' },
        ],
        { capacity: 1 },
      );

      expect(effects[0]).toEqual({ type: 'resolveTokens', tokens: ['t1'], requestId: 'r1', responseCode: 'success' });
      expect(submits(effects)).toHaveLength(1);
    });

    // A retransmit gives the batch a new id, but a response to any earlier id still
    // answers the same messages and must not be dropped.
    it('accepts a response to a superseded retransmit id', () => {
      const { effects } = run([
        ACTIVATE,
        send('a', 't1'),
        send('b', 't2'),
        { type: 'responseReceived', requestId: 'r1', responseCode: 'success' },
      ]);

      expect(effects[0]).toMatchObject({ type: 'resolveTokens', tokens: ['t1', 't2'] });
    });

    it('ignores a response for an unknown request', () => {
      const { effects } = run([
        ACTIVATE,
        send('a', 't1'),
        { type: 'responseReceived', requestId: 'nope', responseCode: 'success' },
      ]);

      expect(effects).toEqual([]);
    });

    it('ignores a second response for an already-answered batch', () => {
      const answered: SessionEvent = { type: 'responseReceived', requestId: 'r1', responseCode: 'success' };
      const { effects } = run([ACTIVATE, send('a', 't1'), answered, answered]);

      expect(effects).toEqual([]);
    });
  });

  describe('request submit failure', () => {
    it('rejects the waiters of the live batch and drains', () => {
      const error = new Error('store rejected');
      const { effects } = run(
        [ACTIVATE, send('a', 't1'), send('b', 't2'), { type: 'requestSubmitFailed', requestId: 'r1', error }],
        { capacity: 1 },
      );

      expect(effects[0]).toEqual({ type: 'rejectTokens', tokens: ['t1'], error });
      expect(submits(effects)).toHaveLength(1);
    });

    // The newer retransmit carries the same tokens, so an older submission's failure is
    // not the live batch's problem.
    it('ignores the failure of a superseded submission', () => {
      const { effects } = run([
        ACTIVATE,
        send('a', 't1'),
        send('b', 't2'),
        { type: 'requestSubmitFailed', requestId: 'r1', error: new Error('stale') },
      ]);

      expect(effects).toEqual([]);
    });

    it('tracks which submission is live', () => {
      expect(liveRequestId(run([ACTIVATE, send('a', 't1')]).state)).toBe('r1');
      // A retransmit takes over: only the newest id is still worth retrying.
      expect(liveRequestId(run([ACTIVATE, send('a', 't1'), send('b', 't2')]).state)).toBe('r2');
    });
  });

  describe('capacity changes', () => {
    it('ships what the queue can now hold when the budget grows', () => {
      // Queued at capacity 1, then re-evaluated once two fit.
      const ctx = makeContext();
      let capacity = 1;
      const sizing: TransitionContext = { ...ctx, fits: messages => messages.length <= capacity };

      let state = transition(initialSessionState(), ACTIVATE, sizing).state;
      state = transition(state, send('a', 't1'), sizing).state;
      state = transition(state, send('b', 't2'), sizing).state;
      expect(state.messageQueue).toHaveLength(1);

      capacity = 2;
      const result = transition(state, { type: 'capacityChanged' }, sizing);

      expect(submits(result.effects).at(-1)).toMatchObject({ messages: [msg('a'), msg('b')] });
      expect(result.state.messageQueue).toEqual([]);
    });

    it('does not ship anything before initialization completes', () => {
      const { effects, state } = run([send('a', 't1'), { type: 'capacityChanged' }]);

      expect(effects).toEqual([]);
      expect(state.messageQueue).toHaveLength(1);
    });
  });

  describe('clearing the outgoing batch', () => {
    it('reports the id to supersede and drops the batch and queue', () => {
      const built = run([ACTIVATE, send('a', 't1'), send('b', 't2')], { capacity: 1 });
      expect(liveRequestId(built.state)).toBe('r1');

      const { state } = run([{ type: 'outgoingCleared' }], { capacity: 1, from: built.state });

      expect(state.outgoingRequest).toBeNull();
      expect(state.messageQueue).toEqual([]);
      expect(liveRequestId(state)).toBeNull();
    });

    it('reports nothing to supersede when nothing is in flight', () => {
      expect(liveRequestId(initialSessionState())).toBeNull();
    });
  });

  describe('restore', () => {
    it('adopts an unacknowledged batch found in the store', () => {
      const { effects } = run([
        { type: 'outgoingRestored', requestId: 'old', messages: [msg('a')] },
        ACTIVATE,
        send('b', 't1'),
      ]);

      // A new message extends the restored batch rather than replacing it.
      expect(effects).toEqual([{ type: 'submitRequest', requestId: 'r1', messages: [msg('a'), msg('b')] }]);
    });

    it('answers a restored batch by its original id, resolving no tokens', () => {
      const { effects } = run([
        { type: 'outgoingRestored', requestId: 'old', messages: [msg('a')] },
        ACTIVATE,
        { type: 'responseReceived', requestId: 'old', responseCode: 'success' },
      ]);

      expect(effects).toEqual([{ type: 'resolveTokens', tokens: [], requestId: 'old', responseCode: 'success' }]);
    });

    it('does not clobber an incoming request a live delivery already tracked', () => {
      const { state } = run([
        { type: 'requestReceived', requestId: 'req' },
        { type: 'incomingRestored', requestId: 'req', responded: true },
      ]);

      expect(incomingRequest(state, 'req')).toEqual({ responded: false });
    });
  });

  describe('incoming requests', () => {
    it('tracks a request once', () => {
      const { state } = run([{ type: 'requestReceived', requestId: 'req' }]);

      expect(incomingRequest(state, 'req')).toEqual({ responded: false });
      expect(incomingRequest(state, 'nope')).toBeUndefined();
    });

    // An async responder must still be able to answer an older request after a newer one
    // arrives — the reason this is a map and not the spec's single value.
    it('keeps an older request answerable after a newer one arrives', () => {
      const { state } = run([
        { type: 'requestReceived', requestId: 'a' },
        { type: 'requestReceived', requestId: 'b' },
      ]);

      expect(incomingRequest(state, 'a')).toEqual({ responded: false });
      expect(incomingRequest(state, 'b')).toEqual({ responded: false });
    });

    it('marks a request answered, and rolls back when the answer fails', () => {
      const tracked: SessionEvent = { type: 'requestReceived', requestId: 'req' };

      const answered = run([tracked, { type: 'responseSubmitted', requestId: 'req' }]);
      expect(incomingRequest(answered.state, 'req')).toEqual({ responded: true });

      const rolledBack = run([{ type: 'responseSubmitFailed', requestId: 'req' }], { from: answered.state });
      expect(incomingRequest(rolledBack.state, 'req')).toEqual({ responded: false });
    });

    it('ignores answer bookkeeping for an untracked request', () => {
      const { state } = run([{ type: 'responseSubmitted', requestId: 'ghost' }]);

      expect(incomingRequest(state, 'ghost')).toBeUndefined();
    });
  });
});
