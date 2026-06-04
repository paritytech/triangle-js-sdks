import type { Statement } from '@novasamatech/sdk-statement';
import { createExpiryFromDuration } from '@novasamatech/sdk-statement';
import type { Result } from 'neverthrow';
import { ResultAsync, errAsync, ok, okAsync } from 'neverthrow';
import type { CodecType } from 'scale-ts';
import { Bytes, str } from 'scale-ts';
import { describe, expect, it, vi } from 'vitest';

import type { StatementsPage } from '../adapter/types.js';
import { createAccountId, createLocalSessionAccount, createRemoteSessionAccount } from '../model/sessionAccount.js';

import type { Encryption } from './encyption.js';
import { StatementData } from './scale/statementData.js';
import { createSession, nextExpiry } from './session.js';
import type { StatementProver } from './statementProver.js';

// Real signature work belongs in statementProver tests; this stub stamps a
// non-empty proof so submitted statements are well-formed.
const mockProver: StatementProver = {
  generateMessageProof: statement =>
    okAsync({
      ...statement,
      proof: {
        type: 'sr25519',
        value: {
          signature: `0x${'00'.repeat(64)}`,
          signer: `0x${'00'.repeat(32)}`,
        },
      },
    }),
  verifyMessageProof: () => okAsync(true),
};

function makeAccounts() {
  const localAccount = createLocalSessionAccount(createAccountId(new Uint8Array(32).fill(1)));
  const remoteAccount = createRemoteSessionAccount(
    createAccountId(new Uint8Array(32).fill(2)),
    new Uint8Array(32).fill(3),
  );
  return { localAccount, remoteAccount };
}

function mockEncryption(): Encryption {
  return {
    encrypt: (data: Uint8Array) => ok(data),
    decrypt: (data: Uint8Array) => ok(data),
  };
}

function makeAdapter() {
  const unsub = vi.fn();
  return {
    queryStatements: vi.fn().mockReturnValue(okAsync([])),
    subscribeStatements: vi.fn().mockReturnValue(unsub),
    submitStatement: vi.fn().mockReturnValue(okAsync(undefined)),
  };
}

function makeStatement(statementData: CodecType<typeof StatementData>, expiry?: bigint): Statement {
  return {
    expiry: expiry ?? createExpiryFromDuration(7 * 24 * 60 * 60),
    data: StatementData.enc(statementData),
    topics: [],
    channel: `0x${'00'.repeat(32)}` as `0x${string}`,
  };
}

function makeSession(overrides?: {
  queryStatements?: ReturnType<typeof makeAdapter>['queryStatements'];
  subscribeStatements?: ReturnType<typeof makeAdapter>['subscribeStatements'];
  submitStatement?: ReturnType<typeof makeAdapter>['submitStatement'];
  maxRequestSize?: number;
}) {
  const { localAccount, remoteAccount } = makeAccounts();
  const { maxRequestSize, ...adapterOverrides } = overrides ?? {};
  const adapter = { ...makeAdapter(), ...adapterOverrides };
  const session = createSession({
    localAccount,
    remoteAccount,
    statementStore: adapter,
    encryption: mockEncryption(),
    prover: mockProver,
    // Preserve the pre-refactor SessionId derivation (keyed on the peer's
    // encryption pubkey) so existing channel/topic assertions hold.
    sessionKey: remoteAccount.publicKey,
    maxRequestSize,
  });
  return { session, adapter };
}

async function delay(ttl = 0) {
  await new Promise(resolve => setTimeout(resolve, ttl));
}

describe('session', () => {
  describe('nextExpiry', () => {
    it('returns fresh expiry when current is 0', () => {
      const result = nextExpiry(0n);
      expect(result).toBeGreaterThan(0n);
    });

    it('returns fresh expiry when current is less than fresh', () => {
      const stale = createExpiryFromDuration(1); // 1 second from now, will be smaller than 7-day
      const result = nextExpiry(stale);
      const fresh = createExpiryFromDuration(7 * 24 * 60 * 60);
      expect(result).toBeGreaterThanOrEqual(fresh);
    });

    it('returns current + 1n when current is already at or above fresh', () => {
      const high = createExpiryFromDuration(7 * 24 * 60 * 60 + 999999);
      const result = nextExpiry(high);
      expect(result).toBe(high + 1n);
    });

    it('is monotonically increasing across repeated calls', () => {
      let expiry = 0n;
      for (let i = 0; i < 5; i++) {
        const next = nextExpiry(expiry);
        expect(next).toBeGreaterThan(expiry);
        expiry = next;
      }
    });
  });

  describe('createSession initialization', () => {
    it('queries own and peer statements on creation', async () => {
      const { adapter } = makeSession();
      await delay();
      // Two single-topic matchAll queries — one per channel (outgoing/incoming).
      // The topics must differ; otherwise both queries would target the same channel.
      const topics = adapter.queryStatements.mock.calls.map(([f]) => (f as { matchAll: unknown[] }).matchAll);
      expect(topics).toHaveLength(2);
      expect(topics.map(t => t.length)).toEqual([1, 1]);
      expect(topics[0]).not.toEqual(topics[1]);
    });

    it('expiry is initialized from max own statement expiry', async () => {
      const highExpiry = createExpiryFromDuration(7 * 24 * 60 * 60) + 9999n;
      const ownRequest = makeStatement({ tag: 'request', value: { requestId: 'r1', data: [] } }, highExpiry);

      const adapter = makeAdapter();
      let firstCall = true;
      adapter.queryStatements.mockImplementation(() => {
        if (firstCall) {
          firstCall = false;
          return okAsync([ownRequest]);
        }
        return okAsync([]);
      });

      const { session } = makeSession(adapter);
      await delay();

      // Submit a message to trigger a statement — its expiry must be greater than highExpiry
      const rawCodec = Bytes();
      void session.submitRequestMessage(rawCodec, new Uint8Array([1]));
      await delay();

      const submittedStatement = adapter.submitStatement.mock.calls[0]?.[0] as Statement | undefined;
      if (submittedStatement) {
        expect(submittedStatement.expiry).toBeGreaterThan(highExpiry);
      }
    });

    it('marks own and peer statement data as seen during init', async () => {
      const peerRequest = makeStatement({ tag: 'request', value: { requestId: 'r2', data: [new Uint8Array([1])] } });

      const adapter = makeAdapter();
      let callCount = 0;
      adapter.queryStatements.mockImplementation(() => {
        callCount++;
        if (callCount === 2) return okAsync([peerRequest]);
        return okAsync([]);
      });

      const { session } = makeSession(adapter);
      await delay();

      // Register subscriber AFTER init — buffered incoming request should be delivered
      const callback = vi.fn();
      session.subscribe(Bytes(), callback);

      expect(callback).toHaveBeenCalled();
    });

    it('transitions to active phase after queries complete', async () => {
      const { session, adapter } = makeSession();

      // Before init completes, submitRequestMessage queues the message
      void session.submitRequestMessage(str, 'hello');

      // Statement should NOT be submitted yet (still initializing)
      expect(adapter.submitStatement).not.toHaveBeenCalled();

      await delay();

      // After init, queued messages are processed → submitStatement called
      expect(adapter.submitStatement).toHaveBeenCalled();
    });
  });

  describe('session state restoration', () => {
    it('restores outgoingRequest when own has request with no peer response', async () => {
      const requestId = 'saved-request-id';
      const ownRequest = makeStatement({ tag: 'request', value: { requestId, data: [] } });

      const adapter = makeAdapter();
      let callCount = 0;
      adapter.queryStatements.mockImplementation(() => {
        callCount++;
        if (callCount === 1) return okAsync([ownRequest]);
        return okAsync([]); // no peer response
      });

      const { session } = makeSession(adapter);
      await delay();

      // If outgoingRequest was restored, a new message appends to it
      const codec = str;
      void session.submitRequestMessage(codec, 'hello');
      await delay();

      expect(adapter.submitStatement).toHaveBeenCalled();
    });

    it('clears outgoingRequest when peer has a matching response', async () => {
      const requestId = 'acked-request';
      const ownRequest = makeStatement({ tag: 'request', value: { requestId, data: [] } });
      const peerResponse = makeStatement({ tag: 'response', value: { requestId, responseCode: 'success' } });

      const adapter = makeAdapter();
      let callCount = 0;
      adapter.queryStatements.mockImplementation(() => {
        callCount++;
        // Outgoing topic contains both our request AND the peer's response
        if (callCount === 1) return okAsync([ownRequest, peerResponse]);
        return okAsync([]);
      });

      const { session } = makeSession(adapter);
      await delay();

      // No pending outgoing request — new message creates a brand new request
      const codec = str;
      void session.submitRequestMessage(codec, 'hi');
      await delay();

      // submitStatement called exactly once (for the new message only)
      expect(adapter.submitStatement).toHaveBeenCalledTimes(1);
    });

    it('restores incomingRequest from peer statements', async () => {
      const requestId = 'peer-request-id';
      const peerRequest = makeStatement({ tag: 'request', value: { requestId, data: [] } });

      const adapter = makeAdapter();
      let callCount = 0;
      adapter.queryStatements.mockImplementation(() => {
        callCount++;
        if (callCount === 2) return okAsync([peerRequest]);
        return okAsync([]);
      });

      const { session } = makeSession(adapter);
      await delay();

      // Calling submitResponseMessage with restored requestId should succeed
      const result = await session.submitResponseMessage(requestId, 'success');
      expect(result.isOk()).toBe(true);
    });

    it('sets respondedIncomingRequest=true when own has a response for the peer request', async () => {
      const requestId = 'peer-request-id';
      const peerRequest = makeStatement({ tag: 'request', value: { requestId, data: [] } });
      const ownResponse = makeStatement({ tag: 'response', value: { requestId, responseCode: 'success' } });

      const adapter = makeAdapter();
      let callCount = 0;
      adapter.queryStatements.mockImplementation(() => {
        callCount++;
        if (callCount === 1) return okAsync([]);
        // Incoming topic contains both the peer's request AND our response
        return okAsync([peerRequest, ownResponse]);
      });

      const { session } = makeSession(adapter);
      await delay();

      // Already responded — submitResponseMessage should return ok without submitting again
      const submitsBefore = adapter.submitStatement.mock.calls.length;
      const result = await session.submitResponseMessage(requestId, 'success');
      expect(result.isOk()).toBe(true);
      expect(adapter.submitStatement.mock.calls.length).toBe(submitsBefore); // no new submit
    });
  });

  describe('subscribe', () => {
    const rawCodec = Bytes();

    it('delivers buffered init messages when subscriber registers after init', async () => {
      const requestId = 'incoming-req';
      const peerRequest = makeStatement({ tag: 'request', value: { requestId, data: [new Uint8Array([1, 2, 3])] } });

      const adapter = makeAdapter();
      let callCount = 0;
      adapter.queryStatements.mockImplementation(() => {
        callCount++;
        if (callCount === 2) return okAsync([peerRequest]);
        return okAsync([]);
      });

      const { session } = makeSession(adapter);
      await delay(); // init completes

      const callback = vi.fn();
      session.subscribe(rawCodec, callback);

      expect(callback).toHaveBeenCalledTimes(1);
      const messages = (callback.mock.calls[0] as [Array<{ type: string; requestId: string }>])[0];
      expect(messages[0]?.type).toBe('request');
      expect(messages[0]?.requestId).toBe(requestId);
    });

    it('delivers init messages via subscribe when subscriber is registered before init completes', async () => {
      const requestId = 'early-subscribe';
      const peerRequest = makeStatement({ tag: 'request', value: { requestId, data: [new Uint8Array([1])] } });

      const adapter = makeAdapter();
      let callCount = 0;
      adapter.queryStatements.mockImplementation(() => {
        callCount++;
        if (callCount === 2) return okAsync([peerRequest]);
        return okAsync([]);
      });

      const { session } = makeSession(adapter);

      const callback = vi.fn();
      session.subscribe(rawCodec, callback); // before init completes

      await delay();

      expect(callback).toHaveBeenCalledTimes(1);
      const messages2 = (callback.mock.calls[0] as [Array<{ requestId: string }>])[0];
      expect(messages2[0]?.requestId).toBe(requestId);
    });

    it('does NOT deliver already-seen statements from subscription', async () => {
      const requestId = 'seen-req';
      const peerRequest = makeStatement({ tag: 'request', value: { requestId, data: [new Uint8Array([1])] } });

      const adapter = makeAdapter();
      let queryCallCount = 0;
      adapter.queryStatements.mockImplementation(() => {
        queryCallCount++;
        if (queryCallCount === 2) return okAsync([peerRequest]);
        return okAsync([]);
      });

      let subscribeCallback!: (page: StatementsPage) => void;
      adapter.subscribeStatements.mockImplementation((_filter: unknown, cb: (page: StatementsPage) => void) => {
        subscribeCallback = cb;
        return vi.fn();
      });

      const { session } = makeSession(adapter);
      await delay(); // init sees peerRequest, adds to seenStatements

      const appCallback = vi.fn();
      session.subscribe(rawCodec, appCallback);

      // Simulate subscription delivering the same statement again
      subscribeCallback({ statements: [peerRequest], isComplete: true });
      await delay();

      // Should only be called once (from buffered init message), not again from subscription
      expect(appCallback).toHaveBeenCalledTimes(1);
    });

    it('does NOT auto-send a response when an incoming request arrives', async () => {
      const requestId = 'no-auto-resp';
      const peerRequest = makeStatement({ tag: 'request', value: { requestId, data: [new Uint8Array([1])] } });

      const adapter = makeAdapter();
      const subscribeCallbacks: Array<(page: StatementsPage) => void> = [];
      adapter.subscribeStatements.mockImplementation((_filter: unknown, cb: (page: StatementsPage) => void) => {
        subscribeCallbacks.push(cb);
        return vi.fn();
      });
      adapter.queryStatements.mockReturnValue(okAsync([]));

      const { session } = makeSession(adapter);
      await delay();

      const callback = vi.fn();
      session.subscribe(rawCodec, callback);

      adapter.submitStatement.mockClear();
      // Fire on the incoming topic callback (first subscription)
      subscribeCallbacks[0]!({ statements: [peerRequest], isComplete: true });
      await delay();

      // Message delivered to app callback but no automatic response submitted
      expect(callback).toHaveBeenCalled();
      expect(adapter.submitStatement).not.toHaveBeenCalled();
    });

    it('delivers peer request to a subscriber that registers after the batch notification (race condition)', async () => {
      // Regression test for PB-439: when peer's request and the ACK response arrive in the
      // same subscribeStatements batch, the request is processed before waitForRequestMessage
      // has a chance to register its subscriber. The fix ensures request statements are always
      // buffered so late subscribers (simulating waitForRequestMessage called in .andThen()
      // after waitForResponseMessage resolves) still receive them.
      const subscribeCallbacks: Array<(page: StatementsPage) => void> = [];
      const subscribeStatements = vi.fn().mockImplementation((_filter: unknown, cb: (page: StatementsPage) => void) => {
        subscribeCallbacks.push(cb);
        return vi.fn();
      });

      const { session } = makeSession({ subscribeStatements });
      await delay();

      // Register a dummy subscriber to activate the store subscription (simulates
      // any pre-existing subscriber in the session, e.g. the app listening for messages).
      const dummyUnsub = session.subscribe(rawCodec, vi.fn());

      const peerRequestId = 'race-condition-request';
      const peerRequest = makeStatement({
        tag: 'request',
        value: { requestId: peerRequestId, data: [new Uint8Array([42])] },
      });

      // Peer request arrives on the incoming topic (first subscription) while the
      // dummy subscriber is active but waitForRequestMessage hasn't registered its
      // subscriber yet (the race condition scenario).
      subscribeCallbacks[0]!({ statements: [peerRequest], isComplete: true });
      await delay();

      // Now the late subscriber registers (simulates waitForRequestMessage being called
      // in the .andThen() chain after waitForResponseMessage resolves).
      const lateCallback = vi.fn();
      session.subscribe(rawCodec, lateCallback);

      // The late subscriber must receive the buffered peer request, otherwise
      // waitForRequestMessage would hang indefinitely.
      expect(lateCallback).toHaveBeenCalledTimes(1);
      const messages = (lateCallback.mock.calls[0] as [Array<{ type: string; requestId: string }>])[0];
      expect(messages[0]?.type).toBe('request');
      expect(messages[0]?.requestId).toBe(peerRequestId);

      dummyUnsub();
    });

    it('unsubscribing last subscriber tears down the store subscription', () => {
      const { session, adapter } = makeSession();
      const unsub = session.subscribe(rawCodec, vi.fn());
      expect(adapter.subscribeStatements).toHaveBeenCalledTimes(2);

      unsub();
      // subscribeStatements returns a mock unsubscribe fn — verify it was called
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const storeMockUnsub = adapter.subscribeStatements.mock.results[0]!.value as ReturnType<typeof vi.fn>;
      expect(storeMockUnsub).toHaveBeenCalled();
    });

    it('subscribes to outgoing topic for peer responses alongside incoming topic', () => {
      const { session, adapter } = makeSession();
      session.subscribe(rawCodec, vi.fn());

      // Two subscriptions: one for incoming (peer requests), one for outgoing (peer responses)
      expect(adapter.subscribeStatements).toHaveBeenCalledTimes(2);
    });

    it('tears down outgoing subscription when last subscriber leaves', () => {
      const { session, adapter } = makeSession();
      const unsub = session.subscribe(rawCodec, vi.fn());

      unsub();

      // Both unsubscribe functions should be called
      for (const result of adapter.subscribeStatements.mock.results) {
        const mockUnsub = result.value as ReturnType<typeof vi.fn>;
        expect(mockUnsub).toHaveBeenCalled();
      }
    });

    it('delivers peer response from outgoing topic subscription to subscribers', async () => {
      const subscribeCallbacks: Array<(page: StatementsPage) => void> = [];
      const subscribeStatements = vi.fn().mockImplementation((_topics: unknown, cb: (page: StatementsPage) => void) => {
        subscribeCallbacks.push(cb);
        return vi.fn();
      });

      const { session, adapter } = makeSession({ subscribeStatements });
      await delay();

      // Submit a request so the session has an outgoingRequest
      void session.submitRequestMessage(rawCodec, new Uint8Array([1]));
      await delay();

      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const submitted = adapter.submitStatement.mock.calls[0]![0] as Statement;
      const decoded = StatementData.dec(submitted.data!);
      const requestId = decoded.tag === 'request' ? decoded.value.requestId : '';

      const callback = vi.fn();
      session.subscribe(rawCodec, callback);

      // Deliver the response via the SECOND subscription callback (outgoing topic)
      // subscribeCallbacks[0] = incoming topic, subscribeCallbacks[1] = outgoing topic
      const responseStatement = makeStatement({
        tag: 'response',
        value: { requestId, responseCode: 'success' },
      });
      subscribeCallbacks[1]!({ statements: [responseStatement], isComplete: true });
      await delay();

      // Subscriber should receive the response
      const allCalls = callback.mock.calls.flat();
      const responseMessages = allCalls.flat().filter((m: { type: string }) => m.type === 'response');
      expect(responseMessages.length).toBeGreaterThan(0);
    });

    it('ignores request-type statements from outgoing topic subscription', async () => {
      const subscribeCallbacks: Array<(page: StatementsPage) => void> = [];
      const subscribeStatements = vi.fn().mockImplementation((_topics: unknown, cb: (page: StatementsPage) => void) => {
        subscribeCallbacks.push(cb);
        return vi.fn();
      });

      const { session } = makeSession({ subscribeStatements });
      await delay();

      const callback = vi.fn();
      session.subscribe(rawCodec, callback);
      callback.mockClear(); // clear any buffered init messages

      // Deliver a request via the outgoing topic subscription (would be our own echoed back)
      const ownRequest = makeStatement({
        tag: 'request',
        value: { requestId: 'own-req', data: [new Uint8Array([1])] },
      });
      subscribeCallbacks[1]!({ statements: [ownRequest], isComplete: true });
      await delay();

      // Should NOT be delivered to subscriber (filtered by responsesOnly flag)
      expect(callback).not.toHaveBeenCalled();
    });
  });

  describe('submitResponseMessage', () => {
    it('is idempotent — second call does not submit again', async () => {
      const requestId = 'req-to-respond';
      const peerRequest = makeStatement({ tag: 'request', value: { requestId, data: [] } });

      const adapter = makeAdapter();
      let callCount = 0;
      adapter.queryStatements.mockImplementation(() => {
        callCount++;
        if (callCount === 2) return okAsync([peerRequest]);
        return okAsync([]);
      });

      const { session } = makeSession(adapter);
      await delay();

      await session.submitResponseMessage(requestId, 'success');
      const submitsAfterFirst = adapter.submitStatement.mock.calls.length;

      await session.submitResponseMessage(requestId, 'success'); // second call
      expect(adapter.submitStatement.mock.calls.length).toBe(submitsAfterFirst);
    });

    it('returns error when requestId does not match incomingRequest', async () => {
      const { session } = makeSession();
      await delay();

      const result = await session.submitResponseMessage('wrong-id', 'success');
      expect(result.isErr()).toBe(true);
    });
  });

  describe('message batching', () => {
    const rawCodec = Bytes();

    it('sends a single statement for the first message', async () => {
      const { session, adapter } = makeSession();
      await delay();

      void session.submitRequestMessage(rawCodec, new Uint8Array([1, 2, 3]));
      await delay();

      expect(adapter.submitStatement).toHaveBeenCalledTimes(1);
    });

    it('appends second message to existing request (resubmits with new requestId)', async () => {
      const { session, adapter } = makeSession();
      await delay();

      void session.submitRequestMessage(rawCodec, new Uint8Array([1]));
      void session.submitRequestMessage(rawCodec, new Uint8Array([2]));
      await delay();

      // Two submits: first for msg1, second for msg1+msg2 batched
      expect(adapter.submitStatement).toHaveBeenCalledTimes(2);
    });

    it('queues message that exceeds maxRequestSize', async () => {
      const { session, adapter } = makeSession({ maxRequestSize: 5 });
      await delay();

      void session.submitRequestMessage(rawCodec, new Uint8Array([1, 2, 3])); // 3 bytes — fits
      void session.submitRequestMessage(rawCodec, new Uint8Array([4, 5, 6, 7])); // 4 bytes — doesn't fit with existing
      await delay();

      // Only first message sent; second is queued
      expect(adapter.submitStatement).toHaveBeenCalledTimes(1);
    });

    it('drains message queue after response received', async () => {
      let subscribeCallback!: (page: StatementsPage) => void;
      const subscribeStatements = vi.fn().mockImplementation((_filter: unknown, cb: (page: StatementsPage) => void) => {
        subscribeCallback = cb;
        return vi.fn();
      });

      const { session, adapter } = makeSession({ maxRequestSize: 5, subscribeStatements });
      await delay();

      session.subscribe(Bytes(), vi.fn()); // ensure store subscription is active

      void session.submitRequestMessage(rawCodec, new Uint8Array([1, 2, 3])); // sent
      void session.submitRequestMessage(rawCodec, new Uint8Array([4, 5, 6])); // queued (doesn't fit)
      await delay();

      const submitCountBefore = adapter.submitStatement.mock.calls.length;

      // Simulate peer responding to the first request
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const lastSubmittedStatement = adapter.submitStatement.mock.calls[
        adapter.submitStatement.mock.calls.length - 1
      ]![0] as Statement;
      const decoded = StatementData.dec(lastSubmittedStatement.data!);
      const respondingRequestId = decoded.tag === 'request' ? decoded.value.requestId : '';
      const responseStatement = makeStatement({
        tag: 'response',
        value: { requestId: respondingRequestId, responseCode: 'success' },
      });

      subscribeCallback({ statements: [responseStatement], isComplete: true });
      await delay();

      // Queued message should now be submitted
      expect(adapter.submitStatement.mock.calls.length).toBeGreaterThan(submitCountBefore);
    });

    it('waitForResponseMessage resolves when response arrives for batch', async () => {
      let subscribeCallback!: (page: StatementsPage) => void;
      const subscribeStatements = vi.fn().mockImplementation((_filter: unknown, cb: (page: StatementsPage) => void) => {
        subscribeCallback = cb;
        return vi.fn();
      });

      const { session, adapter } = makeSession({ subscribeStatements });
      await delay();

      session.subscribe(Bytes(), vi.fn()); // ensure store subscription is active

      const submitResult = await session.submitRequestMessage(rawCodec, new Uint8Array([1]));
      const token = submitResult.unwrapOr({ requestId: '' }).requestId;
      await delay();

      const responsePromise = session.waitForResponseMessage(token);

      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const lastStatement = adapter.submitStatement.mock.calls[
        adapter.submitStatement.mock.calls.length - 1
      ]![0] as Statement;
      const decoded = StatementData.dec(lastStatement.data!);
      const respondingId = decoded.tag === 'request' ? decoded.value.requestId : '';

      subscribeCallback({
        statements: [makeStatement({ tag: 'response', value: { requestId: respondingId, responseCode: 'success' } })],
        isComplete: true,
      });
      await delay();

      const result = await responsePromise;
      expect(result.isOk()).toBe(true);
      expect(result.unwrapOr({ responseCode: 'unknown' as const }).responseCode).toBe('success');
    });
  });

  describe('clearOutgoingStatement', () => {
    it('is a no-op when there is no outgoing request', async () => {
      const { session, adapter } = makeSession();
      await delay();
      const before = adapter.submitStatement.mock.calls.length;

      const result = await session.clearOutgoingStatement();

      expect(result.isOk()).toBe(true);
      expect(adapter.submitStatement.mock.calls.length).toBe(before);
    });

    it('submits an empty request batch on the same channel at >= the live expiry and clears state', async () => {
      const { session, adapter } = makeSession();
      await delay();

      const rawCodec = Bytes();
      void session.submitRequestMessage(rawCodec, new Uint8Array([1, 2, 3]));
      await delay();

      const liveCall = adapter.submitStatement.mock.calls.at(-1)?.[0] as Statement;
      const liveDecoded = StatementData.dec(liveCall.data!);
      expect(liveDecoded.tag).toBe('request');
      if (liveDecoded.tag === 'request') expect(liveDecoded.value.data.length).toBe(1);

      const result = await session.clearOutgoingStatement();
      expect(result.isOk()).toBe(true);

      const clearCall = adapter.submitStatement.mock.calls.at(-1)?.[0] as Statement;
      const clearDecoded = StatementData.dec(clearCall.data!);
      expect(clearDecoded.tag).toBe('request');
      if (clearDecoded.tag === 'request') expect(clearDecoded.value.data).toEqual([]);
      expect(clearCall.channel).toBe(liveCall.channel);
      expect(clearCall.expiry).toBeGreaterThanOrEqual(liveCall.expiry!);

      // Outgoing state is cleared: the next message starts a brand-new batch (data length 1, not 2).
      void session.submitRequestMessage(rawCodec, new Uint8Array([4]));
      await delay();
      const afterClear = adapter.submitStatement.mock.calls.at(-1)?.[0] as Statement;
      const afterDecoded = StatementData.dec(afterClear.data!);
      if (afterDecoded.tag === 'request') expect(afterDecoded.value.data.length).toBe(1);
    });

    it('rejects the pending response waiter so callers unwind', async () => {
      const { session } = makeSession();
      await delay();

      const submit = await session.submitRequestMessage(Bytes(), new Uint8Array([9]));
      expect(submit.isOk()).toBe(true);
      const requestId = submit._unsafeUnwrap().requestId;
      const waiter = session.waitForResponseMessage(requestId);

      await session.clearOutgoingStatement();

      const waited = await waiter;
      expect(waited.isErr()).toBe(true);
    });

    it('clears local state and rejects waiters even when the superseding submission fails', async () => {
      const { session, adapter } = makeSession();
      await delay();

      const rawCodec = Bytes();
      const submit = await session.submitRequestMessage(rawCodec, new Uint8Array([1, 2, 3]));
      const requestId = submit._unsafeUnwrap().requestId;
      const waiter = session.waitForResponseMessage(requestId);

      adapter.submitStatement.mockReturnValueOnce(errAsync(new Error('store rejected')));
      const result = await session.clearOutgoingStatement();
      expect(result.isErr()).toBe(true);

      // The pending waiter is rejected despite the failed submission.
      const waited = await waiter;
      expect(waited.isErr()).toBe(true);

      // Local state is cleared: the next message starts a brand-new batch (data length 1, not 2).
      adapter.submitStatement.mockReturnValue(okAsync(undefined));
      void session.submitRequestMessage(rawCodec, new Uint8Array([4]));
      await delay();
      const afterClear = adapter.submitStatement.mock.calls.at(-1)?.[0] as Statement;
      const afterDecoded = StatementData.dec(afterClear.data!);
      if (afterDecoded.tag === 'request') expect(afterDecoded.value.data.length).toBe(1);
    });

    it('cancels messages queued before the batch is submitted (init still pending)', async () => {
      // queryStatements never resolves, so init() stays pending and the message
      // sits in the queue with outgoingRequest still null.
      const neverResolves = vi
        .fn()
        .mockReturnValue(new ResultAsync(new Promise<Result<unknown, unknown>>(() => undefined)));
      const { session, adapter } = makeSession({ queryStatements: neverResolves });

      const submit = await session.submitRequestMessage(Bytes(), new Uint8Array([7]));
      const requestId = submit._unsafeUnwrap().requestId;
      const waiter = session.waitForResponseMessage(requestId);
      const submitsBefore = adapter.submitStatement.mock.calls.length;

      const result = await session.clearOutgoingStatement();
      expect(result.isOk()).toBe(true);

      // The queued waiter is rejected rather than left to be submitted after init.
      const waited = await waiter;
      expect(waited.isErr()).toBe(true);
      // No empty batch is submitted since there was no live on-chain request yet.
      expect(adapter.submitStatement.mock.calls.length).toBe(submitsBefore);
    });
  });
});
