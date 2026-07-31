import { describe, expect, it } from 'vitest';

import type { SessionEffect } from './stateMachine.js';
import { createSessionStateMachine } from './stateMachine.js';

const msg = (text: string) => new TextEncoder().encode(text);

/**
 * `fits` counts messages rather than bytes, so a test can say "two per statement" and read
 * as the batching rule it exercises. Ids are sequential for the same reason.
 */
function makeMachine({ capacity = Infinity }: { capacity?: number } = {}) {
  let next = 0;

  return createSessionStateMachine({
    fits: messages => messages.length <= capacity,
    newRequestId: () => `r${(++next).toString()}`,
  });
}

const submits = (effects: SessionEffect[]) => effects.filter(e => e.type === 'submitRequest');

/** Activate first: nothing is submitted while the session is still initializing. */
function activeMachine(opts?: { capacity?: number }) {
  const machine = makeMachine(opts);
  machine.activate();

  return machine;
}

describe('session state machine', () => {
  describe('phase', () => {
    it('queues instead of submitting while initializing', () => {
      const machine = makeMachine();

      expect(machine.phase()).toBe('initialization');
      expect(machine.submitMessage(msg('a'), 't1')).toEqual([]);
    });

    it('drains what initialization queued once active', () => {
      const machine = makeMachine();
      machine.submitMessage(msg('a'), 't1');
      machine.submitMessage(msg('b'), 't2');

      const effects = submits(machine.activate());

      expect(machine.phase()).toBe('active');
      // Both ride one batch: the second extends the first, so only the latest submission
      // carries everything unacknowledged.
      expect(effects.at(-1)).toMatchObject({ messages: [msg('a'), msg('b')] });
    });

    it('reports the initialization failure to callers', () => {
      const machine = makeMachine();
      const error = new Error('init failed');
      machine.failInit(error);

      expect(machine.phase()).toBe('failed');
      expect(machine.initError()).toBe(error);
    });
  });

  describe('batching', () => {
    it('submits the first message immediately', () => {
      const machine = activeMachine();

      expect(machine.submitMessage(msg('a'), 't1')).toEqual([
        { type: 'submitRequest', requestId: 'r1', messages: [msg('a')] },
      ]);
    });

    // The store keeps one statement per channel, so each submission must carry every
    // message the peer has not acknowledged — not just the newest one.
    it('resubmits the whole unacknowledged batch when extending it', () => {
      const machine = activeMachine();
      machine.submitMessage(msg('a'), 't1');

      expect(machine.submitMessage(msg('b'), 't2')).toEqual([
        { type: 'submitRequest', requestId: 'r2', messages: [msg('a'), msg('b')] },
      ]);
    });

    it('queues a message that does not fit the live batch', () => {
      const machine = activeMachine({ capacity: 1 });
      machine.submitMessage(msg('a'), 't1');

      expect(machine.submitMessage(msg('b'), 't2')).toEqual([]);
    });

    it('keeps FIFO: a later fitting message never overtakes a queued one', () => {
      const machine = activeMachine({ capacity: 2 });
      machine.submitMessage(msg('a'), 't1');
      machine.submitMessage(msg('b'), 't2');
      // Batch is full, so 'c' waits…
      expect(machine.submitMessage(msg('c'), 't3')).toEqual([]);
      // …and so must 'd', even though the machine could otherwise fit it.
      expect(machine.submitMessage(msg('d'), 't4')).toEqual([]);

      const drained = submits(machine.onResponse('r2', 'success'));
      expect(drained.at(-1)).toMatchObject({ messages: [msg('c'), msg('d')] });
    });

    it('snapshots the messages of each submission', () => {
      const machine = activeMachine();
      const first = machine.submitMessage(msg('a'), 't1');
      machine.submitMessage(msg('b'), 't2');

      // The first effect must not have grown when the batch did.
      expect(first).toEqual([{ type: 'submitRequest', requestId: 'r1', messages: [msg('a')] }]);
    });
  });

  describe('deduplication', () => {
    it('attaches a duplicate of an in-flight message instead of resending', () => {
      const machine = activeMachine();
      machine.submitMessage(msg('a'), 't1');

      expect(machine.submitMessage(msg('a'), 't2')).toEqual([]);

      // Both tokens resolve on the one response.
      const [resolve] = machine.onResponse('r1', 'success');
      expect(resolve).toMatchObject({ type: 'resolveTokens', tokens: ['t1', 't2'] });
    });

    it('attaches a duplicate of a queued message', () => {
      const machine = activeMachine({ capacity: 1 });
      machine.submitMessage(msg('a'), 't1');
      machine.submitMessage(msg('b'), 't2');

      expect(machine.submitMessage(msg('b'), 't3')).toEqual([]);

      const effects = machine.onResponse('r1', 'success');
      expect(submits(effects).at(-1)).toMatchObject({ messages: [msg('b')] });
    });
  });

  describe('responses', () => {
    it('resolves the batch tokens and drains the queue', () => {
      const machine = activeMachine({ capacity: 1 });
      machine.submitMessage(msg('a'), 't1');
      machine.submitMessage(msg('b'), 't2');

      const effects = machine.onResponse('r1', 'success');

      expect(effects[0]).toEqual({ type: 'resolveTokens', tokens: ['t1'], requestId: 'r1', responseCode: 'success' });
      expect(submits(effects)).toHaveLength(1);
    });

    // A retransmit gives the batch a new id, but a response to any earlier id still
    // answers the same messages and must not be dropped.
    it('accepts a response to a superseded retransmit id', () => {
      const machine = activeMachine();
      machine.submitMessage(msg('a'), 't1');
      machine.submitMessage(msg('b'), 't2');

      const effects = machine.onResponse('r1', 'success');

      expect(effects[0]).toMatchObject({ type: 'resolveTokens', tokens: ['t1', 't2'] });
    });

    it('ignores a response for an unknown request', () => {
      const machine = activeMachine();
      machine.submitMessage(msg('a'), 't1');

      expect(machine.onResponse('nope', 'success')).toEqual([]);
    });

    it('ignores a second response for an already-answered batch', () => {
      const machine = activeMachine();
      machine.submitMessage(msg('a'), 't1');
      machine.onResponse('r1', 'success');

      expect(machine.onResponse('r1', 'success')).toEqual([]);
    });
  });

  describe('submit failure', () => {
    it('rejects the waiters of the live batch and drains', () => {
      const machine = activeMachine({ capacity: 1 });
      machine.submitMessage(msg('a'), 't1');
      machine.submitMessage(msg('b'), 't2');
      const error = new Error('store rejected');

      const effects = machine.onSubmitFailed('r1', error);

      expect(effects[0]).toEqual({ type: 'rejectTokens', tokens: ['t1'], error });
      expect(submits(effects)).toHaveLength(1);
    });

    // The newer retransmit carries the same tokens, so an older submission's failure is
    // not the live batch's problem.
    it('ignores the failure of a superseded submission', () => {
      const machine = activeMachine();
      machine.submitMessage(msg('a'), 't1');
      machine.submitMessage(msg('b'), 't2');

      expect(machine.onSubmitFailed('r1', new Error('stale'))).toEqual([]);
    });

    it('tracks which submission is live', () => {
      const machine = activeMachine();
      machine.submitMessage(msg('a'), 't1');
      expect(machine.isLiveRequest('r1')).toBe(true);

      machine.submitMessage(msg('b'), 't2');
      expect(machine.isLiveRequest('r1')).toBe(false);
      expect(machine.isLiveRequest('r2')).toBe(true);
    });
  });

  describe('clearOutgoing', () => {
    it('returns the id to supersede and drops the batch and queue', () => {
      const machine = activeMachine({ capacity: 1 });
      machine.submitMessage(msg('a'), 't1');
      machine.submitMessage(msg('b'), 't2');

      expect(machine.clearOutgoing()).toBe('r1');
      // Nothing left to answer or drain.
      expect(machine.onResponse('r1', 'success')).toEqual([]);
      expect(machine.pendingTokens()).toEqual([]);
    });

    it('returns null when nothing is in flight', () => {
      expect(activeMachine().clearOutgoing()).toBeNull();
    });
  });

  describe('restore', () => {
    it('adopts an unacknowledged batch found in the store', () => {
      const machine = makeMachine();
      machine.restoreOutgoing('old', [msg('a')]);
      machine.activate();

      // A new message extends the restored batch rather than replacing it.
      expect(machine.submitMessage(msg('b'), 't1')).toEqual([
        { type: 'submitRequest', requestId: 'r1', messages: [msg('a'), msg('b')] },
      ]);
    });

    it('answers a restored batch by any of its ids', () => {
      const machine = makeMachine();
      machine.restoreOutgoing('old', [msg('a')]);
      machine.activate();

      expect(machine.onResponse('old', 'success')).toEqual([
        { type: 'resolveTokens', tokens: [], requestId: 'old', responseCode: 'success' },
      ]);
    });

    it('does not clobber an incoming request a live delivery already tracked', () => {
      const machine = makeMachine();
      machine.trackIncoming('req');
      machine.restoreIncoming('req', true);

      expect(machine.incoming('req')).toEqual({ responded: false });
    });
  });

  describe('incoming requests', () => {
    it('tracks a request once', () => {
      const machine = makeMachine();

      expect(machine.trackIncoming('req')).toBe(true);
      expect(machine.trackIncoming('req')).toBe(false);
      expect(machine.incoming('req')).toEqual({ responded: false });
    });

    // An async responder must still be able to answer an older request after a newer one
    // arrives — the reason this is a map and not the spec's single value.
    it('keeps an older request answerable after a newer one arrives', () => {
      const machine = makeMachine();
      machine.trackIncoming('a');
      machine.trackIncoming('b');

      expect(machine.incoming('a')).toEqual({ responded: false });
      expect(machine.incoming('b')).toEqual({ responded: false });
    });

    it('reports nothing for an unknown request', () => {
      expect(makeMachine().incoming('nope')).toBeUndefined();
    });
  });

  it('reports every token still awaiting a response', () => {
    const machine = activeMachine({ capacity: 1 });
    machine.submitMessage(msg('a'), 't1');
    machine.submitMessage(msg('b'), 't2');

    expect(machine.pendingTokens()).toEqual(['t1', 't2']);
  });
});
