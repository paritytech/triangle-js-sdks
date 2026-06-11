import type { SignedStatement, Statement } from '@novasamatech/sdk-statement';
import { createExpiryFromDuration } from '@novasamatech/sdk-statement';
import type { Result } from 'neverthrow';
import { ResultAsync, err, errAsync, ok, okAsync } from 'neverthrow';
import type { CodecType } from 'scale-ts';
import { Bytes, Struct, str } from 'scale-ts';
import { describe, expect, it, vi } from 'vitest';

import { createInMemoryStatementStore } from '../adapter/inMemory.js';
import type { StatementStoreAdapter, StatementsPage } from '../adapter/types.js';
import { AccountFullError, ExpiryTooLowError } from '../adapter/types.js';
import { createAccountId, createLocalSessionAccount, createRemoteSessionAccount } from '../model/sessionAccount.js';

import type { Encryption } from './encyption.js';
import { DecodingError, UnknownError } from './error.js';
import { StatementData } from './scale/statementData.js';
import { STATEMENT_OVERHEAD, createSession } from './session.js';
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

function makeSession(
  opts: {
    /** Statements the OUTGOING-topic query resolves with (own/outgoing channel). */
    own?: Statement[];
    /** Statements the INCOMING-topic query resolves with (peer/incoming channel). */
    peer?: Statement[];
    queryStatements?: ReturnType<typeof makeAdapter>['queryStatements'];
    subscribeStatements?: ReturnType<typeof makeAdapter>['subscribeStatements'];
    submitStatement?: ReturnType<typeof makeAdapter>['submitStatement'];
    maxRequestSize?: number;
  } = {},
) {
  const { localAccount, remoteAccount } = makeAccounts();
  const { own = [], peer = [], maxRequestSize, ...adapterOverrides } = opts;
  const adapter = makeAdapter();
  // init() queries the outgoing (own) topic first, then the incoming (peer) topic.
  let queryCall = 0;
  adapter.queryStatements.mockImplementation(() => okAsync(queryCall++ === 0 ? own : peer));
  // Explicit adapter mocks (e.g. a capturing subscribeStatements, or a custom
  // queryStatements) take precedence over the own/peer defaults.
  Object.assign(adapter, adapterOverrides);
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

// Capture the callbacks the session registers via subscribeStatements so a test can
// push statement pages itself. The session subscribes once, to the incoming topic
// (callbacks[0]), which carries both peer requests and peer responses.
function capturingSubscribe() {
  const callbacks: Array<(page: StatementsPage) => void> = [];
  const subscribeStatements = vi.fn((_filter: unknown, cb: (page: StatementsPage) => void) => {
    callbacks.push(cb);
    return vi.fn();
  });
  return { subscribeStatements, callbacks };
}

function lastSubmitted(adapter: ReturnType<typeof makeAdapter>): Statement {
  return adapter.submitStatement.mock.calls.at(-1)![0] as Statement;
}

function lastSubmittedRequestId(adapter: ReturnType<typeof makeAdapter>): string {
  const decoded = StatementData.dec(lastSubmitted(adapter).data!);
  return decoded.tag === 'request' ? decoded.value.requestId : '';
}

// A submitStatement mock that defers every submission instead of resolving: each call records a
// `{ requestId, settle }` entry in `pendings`, letting a test land or reject submissions in a chosen
// order (used to drive shared-channel supersession races). Works for request and response payloads.
function deferredSubmit() {
  const pendings: Array<{ requestId: string; settle: (r: Result<void, Error>) => void }> = [];
  const submitStatement = vi.fn((stmt: Statement) => {
    const decoded = StatementData.dec(stmt.data!);
    const requestId = decoded.tag === 'request' || decoded.tag === 'response' ? decoded.value.requestId : '';
    return ResultAsync.fromPromise(
      new Promise<void>((resolve, reject) => {
        pendings.push({ requestId, settle: r => (r.isOk() ? resolve() : reject(r.error)) });
      }),
      e => e as Error,
    );
  });
  return { submitStatement, pendings };
}

// Encoded size of the request payload (the statement `data` field) for these messages —
// what the session sizes batches against. Includes the requestId (a fixed-length nanoid)
// and the SCALE vector framing, so it is larger than the raw message bytes alone.
function reqPayloadSize(...messages: Uint8Array[]): number {
  return StatementData.enc({ tag: 'request', value: { requestId: 'x'.repeat(21), data: messages } }).length;
}

async function delay(ttl = 0) {
  await new Promise(resolve => setTimeout(resolve, ttl));
}

// Drain microtasks + macrotasks repeatedly so a multi-hop cross-session
// exchange (submit → deliver → process → submit → …) fully settles.
async function settle() {
  for (let i = 0; i < 12; i++) await delay();
}

// Two mirrored sessions sharing one in-memory store. A SHARED session key makes
// them derive the same SessionId pair (host.outgoing === peer.incoming, and vice
// versa) — a real host/papp pairing. With identity encryption/prover, each side
// decrypts and verifies the other's statements.
const SHARED_KEY = new Uint8Array(32).fill(7);
const localA = createLocalSessionAccount(createAccountId(new Uint8Array(32).fill(1)));
const remoteA = createRemoteSessionAccount(createAccountId(new Uint8Array(32).fill(1)), new Uint8Array(32).fill(11));
const localB = createLocalSessionAccount(createAccountId(new Uint8Array(32).fill(2)));
const remoteB = createRemoteSessionAccount(createAccountId(new Uint8Array(32).fill(2)), new Uint8Array(32).fill(22));

const RemoteMsg = Struct({ id: str, kind: str, respondingTo: str, body: str });
const requestMsg = (id: string): CodecType<typeof RemoteMsg> => ({ id, kind: 'request', respondingTo: '', body: id });

function makeHost(adapter: StatementStoreAdapter) {
  return createSession({
    localAccount: localA,
    remoteAccount: remoteB,
    statementStore: adapter,
    encryption: mockEncryption(),
    prover: mockProver,
    sessionKey: SHARED_KEY,
  });
}
function makeMobile(adapter: StatementStoreAdapter) {
  return createSession({
    localAccount: localB,
    remoteAccount: remoteA,
    statementStore: adapter,
    encryption: mockEncryption(),
    prover: mockProver,
    sessionKey: SHARED_KEY,
  });
}

describe('session', () => {
  const rawCodec = Bytes();

  // On creation a session queries both of its topics, derives the starting expiry, and buffers
  // anything it finds until it goes active. (Spec §5 initialization.)
  describe('initialization', () => {
    it('queries the outgoing and incoming topics on creation', async () => {
      const { adapter } = makeSession();
      await delay();
      // Two single-topic matchAll queries — one per topic (outgoing/incoming); they must differ.
      const topics = adapter.queryStatements.mock.calls.map(([f]) => (f as { matchAll: unknown[] }).matchAll);
      expect(topics).toHaveLength(2);
      expect(topics.map(t => t.length)).toEqual([1, 1]);
      expect(topics[0]).not.toEqual(topics[1]);
    });

    it('seeds the expiry from the highest own statement expiry', async () => {
      const highExpiry = createExpiryFromDuration(7 * 24 * 60 * 60) + 9999n;
      const ownRequest = makeStatement({ tag: 'request', value: { requestId: 'r1', data: [] } }, highExpiry);

      const { session, adapter } = makeSession({ own: [ownRequest] });
      await delay();

      // The next submitted statement must carry an expiry greater than the highest seen.
      void session.submitRequestMessage(rawCodec, new Uint8Array([1]));
      await delay();

      expect(lastSubmitted(adapter).expiry).toBeGreaterThan(highExpiry);
    });

    it('buffers an incoming request found during init for a subscriber that registers later', async () => {
      const peerRequest = makeStatement({ tag: 'request', value: { requestId: 'r2', data: [new Uint8Array([1])] } });

      const { session } = makeSession({ peer: [peerRequest] });
      await delay();

      const callback = vi.fn();
      session.subscribe(rawCodec, callback);

      expect(callback).toHaveBeenCalled();
    });

    it('queues messages submitted before init completes and sends them once active', async () => {
      const { session, adapter } = makeSession();

      // Submitted while still initializing → queued, not sent yet.
      void session.submitRequestMessage(str, 'hello');
      expect(adapter.submitStatement).not.toHaveBeenCalled();

      await delay();

      // After init the queue is drained.
      expect(adapter.submitStatement).toHaveBeenCalled();
    });

    it('does not regress its expiry counter when a response is submitted during init', async () => {
      // A peer request auto-ACKed while init() is still in flight advances both state.expiry and
      // the on-chain channel past the init query snapshot. init() must not reset the counter below
      // that, or the next submit collides at an equal expiry (the single-writer drift).
      let releaseInit!: () => void;
      const initBarrier = new Promise<void>(resolve => {
        releaseInit = resolve;
      });
      const queryStatements = vi.fn(() => ResultAsync.fromSafePromise(initBarrier.then(() => [] as Statement[])));
      const { subscribeStatements, callbacks } = capturingSubscribe();
      const { session, adapter } = makeSession({ queryStatements, subscribeStatements });

      session.respondToRequests(rawCodec, () => 'success'); // activates the subscription + auto-ACK

      // Two peer requests answered while init() is still pending → two response submits.
      callbacks[0]!({
        statements: [makeStatement({ tag: 'request', value: { requestId: 'a', data: [new Uint8Array([1])] } })],
        isComplete: true,
      });
      callbacks[0]!({
        statements: [makeStatement({ tag: 'request', value: { requestId: 'b', data: [new Uint8Array([2])] } })],
        isComplete: true,
      });
      await delay();

      const inInitMax = adapter.submitStatement.mock.calls
        .map(c => (c[0] as Statement).expiry ?? 0n)
        .reduce((m, e) => (e > m ? e : m), 0n);
      expect(inInitMax).toBeGreaterThan(0n); // sanity: responses really went out during init

      releaseInit();
      await delay();

      // A response after init completes must use an expiry strictly above the in-init submits.
      callbacks[0]!({
        statements: [makeStatement({ tag: 'request', value: { requestId: 'c', data: [new Uint8Array([3])] } })],
        isComplete: true,
      });
      await delay();

      const afterInit = (adapter.submitStatement.mock.calls.at(-1)?.[0] as Statement).expiry ?? 0n;
      expect(afterInit).toBeGreaterThan(inInitMax);

      session.dispose();
    });
  });

  // On restart a session rebuilds its in-flight state from the on-chain statements. A request is
  // answered by the PEER's response (read from our incoming topic); we have answered a peer request
  // iff OUR response (on our outgoing topic) carries its id. (Spec §4 response placement + §5.)
  describe('state restoration on restart', () => {
    it('restores the outgoing request when it has no response yet', async () => {
      const ownRequest = makeStatement({ tag: 'request', value: { requestId: 'saved-request-id', data: [] } });

      const { session, adapter } = makeSession({ own: [ownRequest] }); // no peer response
      await delay();

      // If outgoingRequest was restored, a new message appends to it.
      void session.submitRequestMessage(str, 'hello');
      await delay();

      expect(adapter.submitStatement).toHaveBeenCalled();
    });

    it('does not restore the outgoing request once the peer has responded', async () => {
      // Our request is on our outgoing topic; the peer's response to it is on our incoming topic.
      const ownRequest = makeStatement({ tag: 'request', value: { requestId: 'or', data: [new Uint8Array([1])] } });
      const peerResponse = makeStatement({ tag: 'response', value: { requestId: 'or', responseCode: 'success' } });
      const { session, adapter } = makeSession({ own: [ownRequest], peer: [peerResponse] });
      await delay();

      // Answered → not restored as pending → a new message starts a fresh batch (data length 1, not 2).
      void session.submitRequestMessage(rawCodec, new Uint8Array([9]));
      await delay();
      const decoded = StatementData.dec(lastSubmitted(adapter).data!);
      expect(decoded.tag === 'request' && decoded.value.data.length).toBe(1);

      session.dispose();
    });

    it('restores an unanswered incoming request so it can still be answered', async () => {
      const requestId = 'peer-request-id';
      const peerRequest = makeStatement({ tag: 'request', value: { requestId, data: [] } });

      const { session } = makeSession({ peer: [peerRequest] });
      await delay();

      const result = await session.submitResponseMessage(requestId, 'success');
      expect(result.isOk()).toBe(true);
    });

    it('treats an incoming request as already answered when our response is present (no resubmit)', async () => {
      const requestId = 'peer-request-id';
      const peerRequest = makeStatement({ tag: 'request', value: { requestId, data: [] } });
      const ownResponse = makeStatement({ tag: 'response', value: { requestId, responseCode: 'success' } });

      // The peer's request is on our incoming topic; OUR response to it is on our outgoing topic.
      const { session, adapter } = makeSession({ own: [ownResponse], peer: [peerRequest] });
      await delay();

      const submitsBefore = adapter.submitStatement.mock.calls.length;
      const result = await session.submitResponseMessage(requestId, 'success');
      expect(result.isOk()).toBe(true);
      expect(adapter.submitStatement.mock.calls.length).toBe(submitsBefore); // no new submit
    });

    it('does not re-deliver an incoming request we already answered', async () => {
      const peerRequest = makeStatement({ tag: 'request', value: { requestId: 'pr', data: [new Uint8Array([1])] } });
      const ownResponse = makeStatement({ tag: 'response', value: { requestId: 'pr', responseCode: 'success' } });
      const { session } = makeSession({ own: [ownResponse], peer: [peerRequest] });
      await delay();

      const cb = vi.fn();
      session.subscribe(rawCodec, cb);
      expect(cb).not.toHaveBeenCalled(); // already responded → not re-delivered for re-processing

      session.dispose();
    });
  });

  // Outgoing messages are batched into one in-flight request; overflow is queued and sent only once
  // the live request is answered. Identical messages are de-duplicated, order is preserved, and the
  // batch is sized against the statement limit minus the fixed wire overhead. (Spec §6.)
  describe('sending requests', () => {
    it('sends a single statement for the first message', async () => {
      const { session, adapter } = makeSession();
      await delay();

      void session.submitRequestMessage(rawCodec, new Uint8Array([1, 2, 3]));
      await delay();

      expect(adapter.submitStatement).toHaveBeenCalledTimes(1);
    });

    it('appends a second message to the in-flight batch and resubmits', async () => {
      const { session, adapter } = makeSession();
      await delay();

      void session.submitRequestMessage(rawCodec, new Uint8Array([1]));
      void session.submitRequestMessage(rawCodec, new Uint8Array([2]));
      await delay();

      // Two submits: first for msg1, second for the msg1+msg2 batch.
      expect(adapter.submitStatement).toHaveBeenCalledTimes(2);
    });

    it('sizes a batch by its full encoded payload, not the raw message bytes', async () => {
      const m1 = rawCodec.enc(new Uint8Array([1, 2, 3]));
      const m2 = rawCodec.enc(new Uint8Array([4, 5, 6]));
      // Budget fits a one-message request but not a two-message one — even though the raw
      // message bytes are tiny, the requestId + SCALE framing tip the second over the limit.
      const maxRequestSize = STATEMENT_OVERHEAD + reqPayloadSize(m1, m2) - 1;
      expect(m1.length + m2.length).toBeLessThan(reqPayloadSize(m1)); // raw sum < a single-message payload

      const { session, adapter } = makeSession({ maxRequestSize });
      await delay();

      void session.submitRequestMessage(rawCodec, new Uint8Array([1, 2, 3]));
      void session.submitRequestMessage(rawCodec, new Uint8Array([4, 5, 6])); // raw sum fits, full payload doesn't
      await delay();

      // The second message is queued, not appended → only the first batch was submitted.
      expect(adapter.submitStatement).toHaveBeenCalledTimes(1);
    });

    it('drains the queue after the in-flight batch is answered', async () => {
      const { subscribeStatements, callbacks } = capturingSubscribe();

      const m1 = rawCodec.enc(new Uint8Array([1, 2, 3]));
      const m2 = rawCodec.enc(new Uint8Array([4, 5, 6]));
      const maxRequestSize = STATEMENT_OVERHEAD + reqPayloadSize(m1, m2) - 1; // m1 fits, m1+m2 doesn't
      const { session, adapter } = makeSession({ maxRequestSize, subscribeStatements });
      await delay();

      session.subscribe(Bytes(), vi.fn()); // ensure the store subscription is active

      void session.submitRequestMessage(rawCodec, new Uint8Array([1, 2, 3])); // sent
      void session.submitRequestMessage(rawCodec, new Uint8Array([4, 5, 6])); // queued (doesn't fit)
      await delay();

      const submitCountBefore = adapter.submitStatement.mock.calls.length;

      // Peer responds to the live request (responses arrive on our incoming topic).
      const responseStatement = makeStatement({
        tag: 'response',
        value: { requestId: lastSubmittedRequestId(adapter), responseCode: 'success' },
      });
      callbacks[0]!({ statements: [responseStatement], isComplete: true });
      await delay();

      // The queued message is now submitted.
      expect(adapter.submitStatement.mock.calls.length).toBeGreaterThan(submitCountBefore);
    });

    it('resolves waitForResponseMessage when the batch is answered', async () => {
      const { subscribeStatements, callbacks } = capturingSubscribe();

      const { session, adapter } = makeSession({ subscribeStatements });
      await delay();

      session.subscribe(Bytes(), vi.fn()); // ensure the store subscription is active

      const submitResult = await session.submitRequestMessage(rawCodec, new Uint8Array([1]));
      const token = submitResult.unwrapOr({ requestId: '' }).requestId;
      await delay();

      const responsePromise = session.waitForResponseMessage(token);

      callbacks[0]!({
        statements: [
          makeStatement({
            tag: 'response',
            value: { requestId: lastSubmittedRequestId(adapter), responseCode: 'success' },
          }),
        ],
        isComplete: true,
      });
      await delay();

      const result = await responsePromise;
      expect(result.isOk()).toBe(true);
      expect(result.unwrapOr({ responseCode: 'unknown' as const }).responseCode).toBe('success');
    });

    it('does not resend a message that is already in flight (dedup)', async () => {
      const store = createInMemoryStatementStore();
      const session = makeHost(store);
      await settle();

      const msg = new Uint8Array([1, 2, 3]);
      void session.submitRequestMessage(rawCodec, msg);
      await settle();
      const acceptedAfterFirst = store.acceptedStatements().length;

      void session.submitRequestMessage(rawCodec, msg); // identical → must not resubmit
      await settle();
      expect(store.acceptedStatements().length).toBe(acceptedAfterFirst);

      session.dispose();
    });

    it('resolves every caller of a deduplicated message on the single response', async () => {
      const { subscribeStatements, callbacks } = capturingSubscribe();
      const { session, adapter } = makeSession({ subscribeStatements });
      await delay();
      session.subscribe(rawCodec, vi.fn());

      const r1 = await session.submitRequestMessage(rawCodec, new Uint8Array([7, 7]));
      const r2 = await session.submitRequestMessage(rawCodec, new Uint8Array([7, 7])); // duplicate
      const w1 = session.waitForResponseMessage(r1._unsafeUnwrap().requestId);
      const w2 = session.waitForResponseMessage(r2._unsafeUnwrap().requestId);
      await delay();

      callbacks[0]!({
        statements: [
          makeStatement({
            tag: 'response',
            value: { requestId: lastSubmittedRequestId(adapter), responseCode: 'success' },
          }),
        ],
        isComplete: true,
      });
      await delay();

      expect((await w1).isOk()).toBe(true);
      expect((await w2).isOk()).toBe(true);
    });

    it('preserves FIFO order: a later fitting message does not overtake queued ones', async () => {
      const m1 = rawCodec.enc(new Uint8Array([1, 2, 3])); // first → in-flight batch
      const mBig = rawCodec.enc(new Uint8Array([4, 5, 6, 7, 8, 9, 10])); // does not fit alongside m1 → queued
      const mSmall = rawCodec.enc(new Uint8Array([9])); // would fit alongside m1, but must queue behind mBig
      const maxRequestSize = STATEMENT_OVERHEAD + reqPayloadSize(m1, mBig) - 1;
      expect(reqPayloadSize(m1, mSmall)).toBeLessThanOrEqual(reqPayloadSize(m1, mBig) - 1); // mSmall alone could fit

      const { session, adapter } = makeSession({ maxRequestSize });
      await delay();

      void session.submitRequestMessage(rawCodec, new Uint8Array([1, 2, 3]));
      void session.submitRequestMessage(rawCodec, new Uint8Array([4, 5, 6, 7, 8, 9, 10]));
      void session.submitRequestMessage(rawCodec, new Uint8Array([9]));
      await delay();

      const decoded = StatementData.dec(lastSubmitted(adapter).data!);
      expect(decoded.tag === 'request' && decoded.value.data.length).toBe(1); // still only the first message
    });

    it('rejects a message whose full request payload exceeds the limit', async () => {
      const m = rawCodec.enc(new Uint8Array([1, 2, 3, 4]));
      // The single-message request payload (requestId + framing + the message) is over budget.
      const { session, adapter } = makeSession({ maxRequestSize: STATEMENT_OVERHEAD + reqPayloadSize(m) - 1 });
      await delay();
      adapter.submitStatement.mockClear();

      const result = await session.submitRequestMessage(rawCodec, new Uint8Array([1, 2, 3, 4]));
      expect(result.isErr()).toBe(true);
      expect(adapter.submitStatement).not.toHaveBeenCalled();
    });
  });

  // A single subscription on the incoming topic carries both peer requests and peer responses.
  // Requests are buffered so a subscriber registering after delivery still receives them; already
  // seen statements are dropped. (Spec §4 reading + §6 dedup.)
  describe('receiving statements', () => {
    it('delivers a buffered incoming request to a subscriber that registers after init', async () => {
      const requestId = 'incoming-req';
      const peerRequest = makeStatement({ tag: 'request', value: { requestId, data: [new Uint8Array([1, 2, 3])] } });

      const { session } = makeSession({ peer: [peerRequest] });
      await delay(); // init completes

      const callback = vi.fn();
      session.subscribe(rawCodec, callback);

      expect(callback).toHaveBeenCalledTimes(1);
      const messages = (callback.mock.calls[0] as [Array<{ type: string; requestId: string }>])[0];
      expect(messages[0]?.type).toBe('request');
      expect(messages[0]?.requestId).toBe(requestId);
    });

    it('delivers a buffered incoming request to a subscriber that registers before init completes', async () => {
      const requestId = 'early-subscribe';
      const peerRequest = makeStatement({ tag: 'request', value: { requestId, data: [new Uint8Array([1])] } });

      const { session } = makeSession({ peer: [peerRequest] });

      const callback = vi.fn();
      session.subscribe(rawCodec, callback); // before init completes

      await delay();

      expect(callback).toHaveBeenCalledTimes(1);
      const messages2 = (callback.mock.calls[0] as [Array<{ requestId: string }>])[0];
      expect(messages2[0]?.requestId).toBe(requestId);
    });

    it('does not redeliver an already-seen statement', async () => {
      const requestId = 'seen-req';
      const peerRequest = makeStatement({ tag: 'request', value: { requestId, data: [new Uint8Array([1])] } });

      const { subscribeStatements, callbacks } = capturingSubscribe();
      const { session } = makeSession({ peer: [peerRequest], subscribeStatements });
      await delay(); // init sees peerRequest, adds it to seenStatements

      const appCallback = vi.fn();
      session.subscribe(rawCodec, appCallback);

      // The store redelivers the same statement on the incoming topic — dedup must drop it.
      callbacks[0]!({ statements: [peerRequest], isComplete: true });
      await delay();

      // Called only once (from the buffered init message), not again from the subscription.
      expect(appCallback).toHaveBeenCalledTimes(1);
    });

    it('does not auto-respond when an incoming request arrives', async () => {
      const peerRequest = makeStatement({
        tag: 'request',
        value: { requestId: 'no-auto-resp', data: [new Uint8Array([1])] },
      });

      const { subscribeStatements, callbacks } = capturingSubscribe();
      const { session, adapter } = makeSession({ subscribeStatements });
      await delay();

      const callback = vi.fn();
      session.subscribe(rawCodec, callback);

      adapter.submitStatement.mockClear();
      callbacks[0]!({ statements: [peerRequest], isComplete: true });
      await delay();

      // Delivered to the app, but no response is submitted automatically.
      expect(callback).toHaveBeenCalled();
      expect(adapter.submitStatement).not.toHaveBeenCalled();
    });

    it('delivers a buffered request to a subscriber that registers after the batch notification', async () => {
      // When a request and an ACK arrive in the same batch, the request is processed before a later
      // waitForRequestMessage registers its subscriber. Requests are buffered so the late subscriber
      // still receives them (otherwise waitForRequestMessage would hang).
      const { subscribeStatements, callbacks } = capturingSubscribe();

      const { session } = makeSession({ subscribeStatements });
      await delay();

      // A pre-existing subscriber activates the store subscription.
      const dummyUnsub = session.subscribe(rawCodec, vi.fn());

      const peerRequestId = 'race-condition-request';
      const peerRequest = makeStatement({
        tag: 'request',
        value: { requestId: peerRequestId, data: [new Uint8Array([42])] },
      });

      // The request arrives before the late subscriber registers.
      callbacks[0]!({ statements: [peerRequest], isComplete: true });
      await delay();

      const lateCallback = vi.fn();
      session.subscribe(rawCodec, lateCallback);

      expect(lateCallback).toHaveBeenCalledTimes(1);
      const messages = (lateCallback.mock.calls[0] as [Array<{ type: string; requestId: string }>])[0];
      expect(messages[0]?.type).toBe('request');
      expect(messages[0]?.requestId).toBe(peerRequestId);

      dummyUnsub();
    });

    it('resolves waitForRequestMessage from a request already buffered at subscribe time', async () => {
      // The subscribe() replay can invoke the filter synchronously during registration; the
      // unsubscribe handle must already be usable at that point.
      // The inner payload must decode cleanly with rawCodec so the filter actually runs.
      const peerRequest = makeStatement({
        tag: 'request',
        value: { requestId: 'buf', data: [rawCodec.enc(new Uint8Array([7]))] },
      });
      const { session } = makeSession({ peer: [peerRequest] });
      await delay(); // init buffers the peer request

      const result = await session.waitForRequestMessage(rawCodec, () => 'matched' as const);
      expect(result._unsafeUnwrap()).toBe('matched');
    }, 2000);

    it('opens a single subscription on the incoming topic', () => {
      const store = createInMemoryStatementStore();
      const session = makeHost(store);
      session.subscribe(rawCodec, vi.fn());

      // One subscription: the incoming topic carries both peer requests and peer responses.
      expect(store.activeSubscriptions()).toBe(1);
    });

    it('tears down the subscription when the last subscriber leaves', () => {
      const store = createInMemoryStatementStore();
      const session = makeHost(store);
      const unsub = session.subscribe(rawCodec, vi.fn());
      expect(store.activeSubscriptions()).toBe(1);

      unsub();

      expect(store.activeSubscriptions()).toBe(0);
    });

    it('delivers a peer response to subscribers', async () => {
      const { subscribeStatements, callbacks } = capturingSubscribe();

      const { session, adapter } = makeSession({ subscribeStatements });
      await delay();

      void session.submitRequestMessage(rawCodec, new Uint8Array([1])); // creates an outgoing request
      await delay();

      const requestId = lastSubmittedRequestId(adapter);

      const callback = vi.fn();
      session.subscribe(rawCodec, callback);

      const responseStatement = makeStatement({
        tag: 'response',
        value: { requestId, responseCode: 'success' },
      });
      callbacks[0]!({ statements: [responseStatement], isComplete: true });
      await delay();

      const allCalls = callback.mock.calls.flat();
      const responseMessages = allCalls.flat().filter((m: { type: string }) => m.type === 'response');
      expect(responseMessages.length).toBeGreaterThan(0);
    });

    it('stops replaying a buffered request to new subscribers once it has been answered', async () => {
      const peerRequest = makeStatement({ tag: 'request', value: { requestId: 'q', data: [new Uint8Array([1])] } });
      const { session } = makeSession({ peer: [peerRequest] });
      await delay(); // init buffers the unanswered request for replay

      await session.submitResponseMessage('q', 'success'); // answer it

      // A subscriber registering afterwards must not be handed the already-answered request
      // (and the buffer must not retain it forever).
      const late = vi.fn();
      session.subscribe(rawCodec, late);
      expect(late).not.toHaveBeenCalled();

      session.dispose();
    });
  });

  // We answer the peer's requests by publishing a response on OUR outgoing topic/response-channel.
  // submitResponseMessage is the low-level primitive; respondToRequests auto-answers from a handler.
  // (Spec §4 response placement.)
  describe('responding to incoming requests', () => {
    it('is idempotent — a second response does not submit again', async () => {
      const requestId = 'req-to-respond';
      const peerRequest = makeStatement({ tag: 'request', value: { requestId, data: [] } });

      const { session, adapter } = makeSession({ peer: [peerRequest] });
      await delay();

      await session.submitResponseMessage(requestId, 'success');
      const submitsAfterFirst = adapter.submitStatement.mock.calls.length;

      await session.submitResponseMessage(requestId, 'success'); // second call
      expect(adapter.submitStatement.mock.calls.length).toBe(submitsAfterFirst);
    });

    it('errors when the requestId is unknown', async () => {
      const { session } = makeSession();
      await delay();

      const result = await session.submitResponseMessage('wrong-id', 'success');
      expect(result.isErr()).toBe(true);
    });

    it('NACKs an undecodable incoming request with decodingFailed', async () => {
      // A request (enum tag 0) whose requestId decodes but whose data vector claims more
      // elements than present → the body decode throws, the requestId is still recoverable.
      const idBytes = new TextEncoder().encode('corrupt-rid');
      const corrupted = new Uint8Array([0x00, idBytes.length << 2, ...idBytes, 0xfe, 0xff, 0xff, 0xff]);
      const statement = { ...makeStatement({ tag: 'request', value: { requestId: 'x', data: [] } }), data: corrupted };

      const { subscribeStatements, callbacks } = capturingSubscribe();
      const { session, adapter } = makeSession({ subscribeStatements });
      await delay();
      session.subscribe(rawCodec, vi.fn()); // activate the subscription
      adapter.submitStatement.mockClear();

      callbacks[0]!({ statements: [statement], isComplete: true });
      await delay();

      expect(adapter.submitStatement).toHaveBeenCalledTimes(1);
      const decoded = StatementData.dec(lastSubmitted(adapter).data!);
      expect(decoded.tag).toBe('response');
      if (decoded.tag === 'response') {
        expect(decoded.value.requestId).toBe('corrupt-rid');
        expect(decoded.value.responseCode).toBe('decodingFailed');
      }
    });

    it('drops an undecodable incoming statement with no recoverable request id', async () => {
      // An invalid enum tag — nothing decodes, so there is no id to NACK.
      const corrupted = new Uint8Array([0x05, 0x2c, 1, 2, 3]);
      const statement = { ...makeStatement({ tag: 'request', value: { requestId: 'x', data: [] } }), data: corrupted };

      const { subscribeStatements, callbacks } = capturingSubscribe();
      const { session, adapter } = makeSession({ subscribeStatements });
      await delay();
      session.subscribe(rawCodec, vi.fn());
      adapter.submitStatement.mockClear();

      callbacks[0]!({ statements: [statement], isComplete: true });
      await delay();

      expect(adapter.submitStatement).not.toHaveBeenCalled();
    });

    it('does not NACK an undecodable copy of a request it already knows', async () => {
      // A valid request is being handled; a corrupt copy of it must not trigger a premature
      // decodingFailed that would mask the real response (the `responded` flag is sticky).
      const reqId = 'known-req';
      const valid = makeStatement({ tag: 'request', value: { requestId: reqId, data: [new Uint8Array([1])] } });
      const idBytes = new TextEncoder().encode(reqId);
      const corrupt = new Uint8Array([0x00, idBytes.length << 2, ...idBytes, 0xfe, 0xff, 0xff, 0xff]);
      const corruptStatement = {
        ...makeStatement({ tag: 'request', value: { requestId: 'x', data: [] } }),
        data: corrupt,
      };

      const { subscribeStatements, callbacks } = capturingSubscribe();
      const { session, adapter } = makeSession({ subscribeStatements });
      await delay();
      session.subscribe(rawCodec, vi.fn()); // activate the subscription

      callbacks[0]!({ statements: [valid], isComplete: true }); // reqId is now a known incoming request
      await delay();
      adapter.submitStatement.mockClear();

      callbacks[0]!({ statements: [corruptStatement], isComplete: true }); // corrupt copy of the same id
      await delay();
      expect(adapter.submitStatement).not.toHaveBeenCalled(); // no premature NACK

      // The legitimate response still goes through.
      const res = await session.submitResponseMessage(reqId, 'success');
      expect(res.isOk()).toBe(true);
      const decoded = StatementData.dec(lastSubmitted(adapter).data!);
      expect(decoded.tag === 'response' && decoded.value.responseCode).toBe('success');
    });

    it('publishes the response on the outgoing topic (same topic as our requests)', async () => {
      const peerRequest = makeStatement({ tag: 'request', value: { requestId: 'rid', data: [] } });
      const { session, adapter } = makeSession({ peer: [peerRequest] });
      await delay();

      void session.submitRequestMessage(rawCodec, new Uint8Array([1])); // → outgoing topic
      await delay();
      const requestTopics = lastSubmitted(adapter).topics;

      adapter.submitStatement.mockClear();
      await session.submitResponseMessage('rid', 'success'); // must also go on the outgoing topic
      const responseTopics = lastSubmitted(adapter).topics;

      expect(responseTopics).toEqual(requestTopics);
    });

    // respondToRequests is exercised end-to-end over a shared in-memory store: a peer issues a real
    // request and the handler's status flows all the way back through request()/mapResponseCode.
    it('acknowledges an incoming request with the status the handler returns', async () => {
      const store = createInMemoryStatementStore();
      const host = makeHost(store);
      const peer = makeMobile(store);
      peer.subscribe(RemoteMsg, () => undefined); // peer must listen to receive the ACK
      host.respondToRequests(RemoteMsg, () => 'success');
      await settle();

      const ack = await peer.request(RemoteMsg, requestMsg('p1'));
      expect(ack.isOk()).toBe(true);

      host.dispose();
      peer.dispose();
    });

    it('maps a decodingFailed status back to the requester', async () => {
      const store = createInMemoryStatementStore();
      const host = makeHost(store);
      const peer = makeMobile(store);
      peer.subscribe(RemoteMsg, () => undefined);
      host.respondToRequests(RemoteMsg, () => okAsync<'decodingFailed', Error>('decodingFailed'));
      await settle();

      const ack = await peer.request(RemoteMsg, requestMsg('p1'));
      expect(ack.isErr()).toBe(true);
      expect(ack._unsafeUnwrapErr()).toBeInstanceOf(DecodingError);

      host.dispose();
      peer.dispose();
    });

    it('answers with unknown when the handler errors', async () => {
      const store = createInMemoryStatementStore();
      const host = makeHost(store);
      const peer = makeMobile(store);
      peer.subscribe(RemoteMsg, () => undefined);
      host.respondToRequests(RemoteMsg, () => errAsync(new Error('handler boom')));
      await settle();

      const ack = await peer.request(RemoteMsg, requestMsg('p1'));
      expect(ack.isErr()).toBe(true);
      expect(ack._unsafeUnwrapErr()).toBeInstanceOf(UnknownError);

      host.dispose();
      peer.dispose();
    });

    it('invokes the handler once per request and never for peer responses', async () => {
      const store = createInMemoryStatementStore();
      const host = makeHost(store);
      const peer = makeMobile(store);
      peer.subscribe(RemoteMsg, () => undefined);
      const handler = vi.fn(() => 'success' as const);
      host.respondToRequests(RemoteMsg, handler);
      await settle();

      await peer.request(RemoteMsg, requestMsg('p1'));
      // The host's own ACK (echoed back on its incoming topic) must not re-trigger the handler.
      expect(handler).toHaveBeenCalledTimes(1);

      host.dispose();
      peer.dispose();
    });

    it('can answer an earlier incoming request after a newer one arrives', async () => {
      const reqA = makeStatement({ tag: 'request', value: { requestId: 'A', data: [] } });
      const { subscribeStatements, callbacks } = capturingSubscribe();
      const { session } = makeSession({ peer: [reqA], subscribeStatements });
      await delay();
      session.subscribe(rawCodec, vi.fn()); // activate the store subscription

      const reqB = makeStatement({ tag: 'request', value: { requestId: 'B', data: [] } });
      callbacks[0]!({ statements: [reqB], isComplete: true });
      await delay();

      const resA = await session.submitResponseMessage('A', 'success');
      const resB = await session.submitResponseMessage('B', 'success');
      expect(resA.isOk()).toBe(true);
      expect(resB.isOk()).toBe(true);
    });

    it('remains answerable after response submission retries are exhausted', async () => {
      const peerRequest = makeStatement({ tag: 'request', value: { requestId: 'rid', data: [] } });
      const { session, adapter } = makeSession({ peer: [peerRequest] });
      await delay();

      adapter.submitStatement.mockReturnValue(errAsync(new Error('store rejected')));
      const first = await session.submitResponseMessage('rid', 'success'); // all retries fail → err + rollback
      expect(first.isErr()).toBe(true);

      adapter.submitStatement.mockReturnValue(okAsync(undefined)); // store recovers
      const submitsBefore = adapter.submitStatement.mock.calls.length;
      const second = await session.submitResponseMessage('rid', 'success'); // retryable → submits and succeeds
      expect(second.isOk()).toBe(true);
      expect(adapter.submitStatement.mock.calls.length).toBeGreaterThan(submitsBefore);
    }, 3000);

    it.each([
      ['ExpiryTooLow', ExpiryTooLowError],
      ['AccountFull', AccountFullError],
    ])(
      'absorbs a superseded response rejected as %s and keeps the request answered',
      async (_name, PriorityError) => {
        // Two incoming requests are answered on the SHARED response channel. The response to A is in
        // flight when the response to B takes over the channel; A then lands at a now-lower expiry and
        // the store rejects it with a priority error. That supersession is expected: B's response owns
        // the channel, so A's rejection must be absorbed (not surfaced) and A must stay marked
        // answered — re-answering would only clobber B. (Returning ok here is also what stops
        // respondToRequests from logging it as a failed response.)
        const reqA = makeStatement({ tag: 'request', value: { requestId: 'A', data: [] } });
        const { subscribeStatements, callbacks } = capturingSubscribe();
        const { submitStatement, pendings } = deferredSubmit();
        const { session, adapter } = makeSession({ peer: [reqA], subscribeStatements, submitStatement });
        await delay();
        session.subscribe(rawCodec, vi.fn()); // activate the store subscription
        const reqB = makeStatement({ tag: 'request', value: { requestId: 'B', data: [] } });
        callbacks[0]!({ statements: [reqB], isComplete: true });
        await delay();

        const resAPromise = session.submitResponseMessage('A', 'success'); // in flight on the shared channel
        const resBPromise = session.submitResponseMessage('B', 'success'); // supersedes A
        await delay(); // both reach submitStatement

        expect(pendings).toHaveLength(2);
        pendings.find(p => p.requestId === 'B')!.settle(ok(undefined)); // B lands, owns the channel
        pendings.find(p => p.requestId === 'A')!.settle(err(new PriorityError(0n, 0n))); // A lands late, rejected

        const resA = await resAPromise;
        const resB = await resBPromise;
        expect(resB.isOk()).toBe(true);
        expect(resA.isOk()).toBe(true); // superseded rejection absorbed, not surfaced as an error

        // A stays answered: re-answering it must NOT submit again (which would clobber B's response).
        const submitsBefore = adapter.submitStatement.mock.calls.length;
        const reAnswer = await session.submitResponseMessage('A', 'success');
        await delay();
        expect(reAnswer.isOk()).toBe(true);
        expect(adapter.submitStatement.mock.calls.length).toBe(submitsBefore); // deduped → no resubmit

        session.dispose();
      },
      3000,
    );
  });

  // clearOutgoingStatement aborts the in-flight request: it drops local state, rejects waiters, and
  // supersedes the on-chain request with an empty batch at a strictly higher expiry.
  describe('aborting the outgoing request', () => {
    it('is a no-op when there is no outgoing request', async () => {
      const { session, adapter } = makeSession();
      await delay();
      const before = adapter.submitStatement.mock.calls.length;

      const result = await session.clearOutgoingStatement();

      expect(result.isOk()).toBe(true);
      expect(adapter.submitStatement.mock.calls.length).toBe(before);
    });

    it('absorbs an ExpiryTooLow on the superseding empty batch as success', async () => {
      // clearOutgoingStatement runs a single direct submit (no submitWithRetry). If the empty batch
      // is rejected ExpiryTooLow, the channel already advanced past us — the request is already gone
      // — so the clear has effectively happened. The caller must see success, not the sync artifact.
      let calls = 0;
      const submitStatement = vi.fn((stmt: Statement) =>
        ++calls === 1
          ? okAsync(undefined) // the request itself lands
          : errAsync(new ExpiryTooLowError(stmt.expiry ?? 0n, (0xffff_ffffn << 32n) | 9_000_000_000n)),
      );
      const { session } = makeSession({ submitStatement });
      await delay();

      void session.submitRequestMessage(rawCodec, new Uint8Array([1]));
      await delay();

      const cleared = await session.clearOutgoingStatement();
      expect(cleared.isOk()).toBe(true); // ExpiryTooLow suppressed
      session.dispose();
    }, 3000);

    it('submits an empty batch on the same channel at a higher expiry and clears local state', async () => {
      const { session, adapter } = makeSession();
      await delay();

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

      // State is cleared: the next message starts a brand-new batch (data length 1, not 2).
      void session.submitRequestMessage(rawCodec, new Uint8Array([4]));
      await delay();
      const afterClear = adapter.submitStatement.mock.calls.at(-1)?.[0] as Statement;
      const afterDecoded = StatementData.dec(afterClear.data!);
      if (afterDecoded.tag === 'request') expect(afterDecoded.value.data.length).toBe(1);
    });

    it('evicts the live on-chain request by superseding it at a strictly higher expiry', async () => {
      // The store rejects an equal-expiry write on the same channel, so the empty batch must go out
      // at a strictly higher expiry to actually evict the live request.
      const store = createInMemoryStatementStore();
      const session = makeHost(store);
      await settle();

      void session.submitRequestMessage(rawCodec, new Uint8Array([1, 2, 3]));
      await settle();

      const result = await session.clearOutgoingStatement();
      expect(result.isOk()).toBe(true);
      await settle();

      const requests = store
        .currentStatements()
        .map(s => StatementData.dec(s.data!))
        .filter(d => d.tag === 'request');
      expect(requests.some(d => d.tag === 'request' && d.value.data.length > 0)).toBe(false);
      expect(requests.some(d => d.tag === 'request' && d.value.data.length === 0)).toBe(true);

      session.dispose();
    });

    it('rejects the pending response waiter so callers unwind', async () => {
      const { session } = makeSession();
      await delay();

      const submit = await session.submitRequestMessage(rawCodec, new Uint8Array([9]));
      expect(submit.isOk()).toBe(true);
      const requestId = submit._unsafeUnwrap().requestId;
      const waiter = session.waitForResponseMessage(requestId);

      await session.clearOutgoingStatement();

      const waited = await waiter;
      expect(waited.isErr()).toBe(true);
    });

    it('clears local state and rejects waiters even when the supersede submission fails', async () => {
      const { session, adapter } = makeSession();
      await delay();

      const submit = await session.submitRequestMessage(rawCodec, new Uint8Array([1, 2, 3]));
      const requestId = submit._unsafeUnwrap().requestId;
      const waiter = session.waitForResponseMessage(requestId);

      adapter.submitStatement.mockReturnValueOnce(errAsync(new Error('store rejected')));
      const result = await session.clearOutgoingStatement();
      expect(result.isErr()).toBe(true);

      // The pending waiter is rejected despite the failed submission.
      const waited = await waiter;
      expect(waited.isErr()).toBe(true);

      // State is cleared: the next message starts a brand-new batch (data length 1, not 2).
      adapter.submitStatement.mockReturnValue(okAsync(undefined));
      void session.submitRequestMessage(rawCodec, new Uint8Array([4]));
      await delay();
      const afterClear = adapter.submitStatement.mock.calls.at(-1)?.[0] as Statement;
      const afterDecoded = StatementData.dec(afterClear.data!);
      if (afterDecoded.tag === 'request') expect(afterDecoded.value.data.length).toBe(1);
    });

    it('cancels messages queued before the batch was submitted (init still pending)', async () => {
      // queryStatements never resolves, so init() stays pending and the message sits in the queue
      // with outgoingRequest still null.
      const neverResolves = vi
        .fn()
        .mockReturnValue(new ResultAsync(new Promise<Result<unknown, unknown>>(() => undefined)));
      const { session, adapter } = makeSession({ queryStatements: neverResolves });

      const submit = await session.submitRequestMessage(rawCodec, new Uint8Array([7]));
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

    it('does not resurrect the aborted request when a submit retry is pending', async () => {
      let calls = 0;
      const submitStatement = vi.fn(() => {
        calls++;
        return calls === 1 ? errAsync(new Error('transient')) : okAsync(undefined); // first request submit fails → retry scheduled
      });
      const { session, adapter } = makeSession({ submitStatement });
      await delay();

      void session.submitRequestMessage(rawCodec, new Uint8Array([1])); // submit #1 fails, schedules a retry
      await session.clearOutgoingStatement(); // abort: drops outgoing state + empty supersede (submit #2)
      const callsAfterAbort = adapter.submitStatement.mock.calls.length;

      await new Promise(resolve => setTimeout(resolve, 100)); // let the (now-stale) retry window elapse

      expect(adapter.submitStatement.mock.calls.length).toBe(callsAfterAbort); // retry must NOT re-send the request
      session.dispose();
    }, 3000);
  });

  // The spec mandates retrying queries (init) and submit_statement on connection failure. The
  // session retries transient failures with a bounded backoff. (Spec §5.)
  describe('resilience (transient-failure retries)', () => {
    it('retries initialization after a transient query failure', async () => {
      let attempts = 0;
      const queryStatements = vi.fn(() => {
        attempts++;
        return attempts <= 2 ? errAsync(new Error('transient')) : okAsync([]); // first init attempt fails
      });
      const { session, adapter } = makeSession({ queryStatements });

      void session.submitRequestMessage(rawCodec, new Uint8Array([1])); // queued during init
      await new Promise(resolve => setTimeout(resolve, 200)); // allow re-init + activation

      expect(adapter.submitStatement).toHaveBeenCalled(); // queued message sent after successful re-init
      session.dispose();
    }, 3000);

    it('retries a request submission that transiently fails', async () => {
      let calls = 0;
      const submitStatement = vi.fn(() => {
        calls++;
        return calls === 1 ? errAsync(new Error('transient')) : okAsync(undefined);
      });
      const { session, adapter } = makeSession({ submitStatement });
      await delay();

      void session.submitRequestMessage(rawCodec, new Uint8Array([1]));
      await new Promise(resolve => setTimeout(resolve, 150)); // allow retry

      expect(adapter.submitStatement.mock.calls.length).toBeGreaterThanOrEqual(2); // 1 failure + ≥1 retry
      session.dispose();
    }, 3000);

    it.each([
      ['ExpiryTooLow', ExpiryTooLowError],
      ['AccountFull', AccountFullError],
    ])(
      'resyncs its expiry above the chain minimum after an %s rejection',
      async (_name, PriorityError) => {
        // The in-memory expiry counter has drifted behind the chain's real priority floor (prior run /
        // other writer / propagation lag / account full of higher-priority statements). The chain
        // reports the minimum; the retry must clear it.
        const CHAIN_MIN = (0xffff_ffffn << 32n) | 4_000_000_000n; // well above the wall-clock priority
        let calls = 0;
        const submitStatement = vi.fn((stmt: Statement) => {
          calls++;
          return calls === 1 ? errAsync(new PriorityError(stmt.expiry ?? 0n, CHAIN_MIN)) : okAsync(undefined);
        });
        const { session, adapter } = makeSession({ submitStatement });
        await delay();

        void session.submitRequestMessage(rawCodec, new Uint8Array([1]));
        await new Promise(resolve => setTimeout(resolve, 100)); // allow the retry (25ms backoff)

        expect(adapter.submitStatement.mock.calls.length).toBeGreaterThanOrEqual(2);
        const retried = adapter.submitStatement.mock.calls.at(-1)?.[0] as Statement;
        expect(retried.expiry ?? 0n).toBeGreaterThan(CHAIN_MIN); // healed past the chain minimum
        session.dispose();
      },
      3000,
    );

    it.each([
      ['ExpiryTooLow', ExpiryTooLowError],
      ['AccountFull', AccountFullError],
    ])(
      'keeps retrying a live %s past the transient-retry cap until it lands',
      async (_name, PriorityError) => {
        // Priority errors are sync artifacts, not chain failures: while the submission is still live
        // the session keeps retrying (resyncing each time) BEYOND MAX_SUBMIT_RETRIES until it lands,
        // and never surfaces the error to the caller. (A non-priority error gives up at the cap —
        // see the test below.)
        const CHAIN_MIN = (0xffff_ffffn << 32n) | 4_000_000_000n;
        let calls = 0;
        const submitStatement = vi.fn((stmt: Statement) =>
          ++calls <= 6 ? errAsync(new PriorityError(stmt.expiry ?? 0n, CHAIN_MIN)) : okAsync(undefined),
        );
        const { session } = makeSession({ submitStatement });
        await delay();

        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        try {
          const submit = await session.submitRequestMessage(rawCodec, new Uint8Array([1]));
          let waiterRejected = false;
          void session.waitForResponseMessage(submit._unsafeUnwrap().requestId).mapErr(() => (waiterRejected = true));

          await new Promise(resolve => setTimeout(resolve, 300)); // 6 retries × 25ms backoff + slack

          expect(calls).toBeGreaterThanOrEqual(7); // retried well past the 3-attempt cap, then landed
          expect(errorSpy).not.toHaveBeenCalledWith('submitRequest failed:', expect.anything());
          expect(waiterRejected).toBe(false); // the priority error never surfaced to the caller
        } finally {
          errorSpy.mockRestore();
          session.dispose();
        }
      },
      3000,
    );

    it('rejects the pending waiter once request-submission retries are exhausted', async () => {
      const { session } = makeSession({
        submitStatement: vi.fn().mockReturnValue(errAsync(new Error('store rejected'))),
      });
      await delay();

      const submit = await session.submitRequestMessage(rawCodec, new Uint8Array([1]));
      const requestId = submit._unsafeUnwrap().requestId;

      const waited = await session.waitForResponseMessage(requestId);
      expect(waited.isErr()).toBe(true);
    }, 2000);

    it('absorbs a superseded older submission rejected as ExpiryTooLow without surfacing an error', async () => {
      // Two messages batch onto one outgoing request: the first submission (requestId A) is in
      // flight when the second (requestId B, higher expiry, SAME tokens) is sent. B lands first and
      // sets the channel priority; A then lands at a now-lower expiry and the store rejects it with
      // ExpiryTooLow. A is superseded, so its rejection is expected protocol behaviour — it must not
      // be logged as an error and must not reject the shared waiters (B carries them).
      const { submitStatement, pendings } = deferredSubmit();
      const { session, adapter } = makeSession({ submitStatement });
      await delay();

      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      try {
        const first = (await session.submitRequestMessage(rawCodec, new Uint8Array([1])))._unsafeUnwrap();
        void session.submitRequestMessage(rawCodec, new Uint8Array([2])); // batches onto the same outgoing request
        await delay(); // let both submissions reach submitStatement

        expect(pendings).toHaveLength(2);
        const liveRequestId = lastSubmittedRequestId(adapter); // the newer (B) submission
        const live = pendings.find(p => p.requestId === liveRequestId)!;
        const superseded = pendings.find(p => p.requestId !== liveRequestId)!;

        let firstWaiterRejected = false;
        void session.waitForResponseMessage(first.requestId).mapErr(() => {
          firstWaiterRejected = true;
        });

        live.settle(ok(undefined)); // B lands, claims the channel priority
        await delay();
        superseded.settle(err(new ExpiryTooLowError(0n, 0n))); // A lands late and is rejected
        await delay();

        expect(errorSpy).not.toHaveBeenCalledWith('submitRequest failed:', expect.anything());
        expect(firstWaiterRejected).toBe(false); // superseded failure must not reject the shared waiter
      } finally {
        errorSpy.mockRestore();
        session.dispose();
      }
    }, 3000);
  });

  describe('dispose', () => {
    it('rejects pending waitForRequestMessage waiters', async () => {
      const { session } = makeSession();
      await delay();

      const waiter = session.waitForRequestMessage(rawCodec, () => 'x' as const);
      session.dispose();

      const result = await waiter;
      expect(result.isErr()).toBe(true);
    }, 2000);

    it('cancels a pending init retry (no further queries)', async () => {
      const queryStatements = vi.fn(() => errAsync(new Error('store down'))); // init always fails → schedules retry
      const { session } = makeSession({ queryStatements });
      await delay(); // first init attempt completes (2 queries) and schedules a retry

      const callsBeforeDispose = queryStatements.mock.calls.length;
      session.dispose();
      await new Promise(resolve => setTimeout(resolve, 100)); // retry window elapses

      expect(queryStatements.mock.calls.length).toBe(callsBeforeDispose); // disposed → no further init queries
    }, 3000);

    it('rejects submitRequestMessage after dispose instead of hanging', async () => {
      const { session, adapter } = makeSession();
      await delay();
      session.dispose();

      const result = await session.submitRequestMessage(rawCodec, new Uint8Array([1]));
      expect(result.isErr()).toBe(true); // surfaced immediately, not a token left pending forever
      expect(adapter.submitStatement).not.toHaveBeenCalled();
    });

    it('rejects submitResponseMessage after dispose', async () => {
      const { session } = makeSession();
      await delay();
      session.dispose();

      const result = await session.submitResponseMessage('any-id', 'success');
      expect(result.isErr()).toBe(true);
    });

    it('does not re-activate when disposed while init is in flight', async () => {
      // dispose() lands during init's query await; init must bail before restoring state / flipping
      // phase to 'active', otherwise a torn-down session looks alive and accepts new work.
      let resolveQueries!: (s: Statement[]) => void;
      const gate = new Promise<Statement[]>(resolve => (resolveQueries = resolve));
      const queryStatements = vi.fn(() => ResultAsync.fromSafePromise(gate));
      const { session, adapter } = makeSession({ queryStatements });

      const queued = await session.submitRequestMessage(rawCodec, new Uint8Array([1])); // queued during init
      expect(queued.isOk()).toBe(true);

      session.dispose(); // dispose mid-init
      resolveQueries([]); // init resumes — must bail before draining the queue / activating
      await settle();

      expect(adapter.submitStatement).not.toHaveBeenCalled(); // no resurrection-driven submit
      const after = await session.submitRequestMessage(rawCodec, new Uint8Array([2]));
      expect(after.isErr()).toBe(true); // session stays disposed
    }, 3000);
  });

  // The in-memory adapter replicates the store's observable contract; `fidelity` pins the double's
  // behaviour, then end-to-end flows run two mirrored sessions (host + mobile) over ONE shared store.
  describe('in-memory statement store', () => {
    const hex = (fill: number) => `0x${fill.toString(16).padStart(2, '0').repeat(32)}` as `0x${string}`;
    function makeSignedStatement(channel: string, expiry: bigint, topic: string, data: Uint8Array): SignedStatement {
      return {
        channel: channel as `0x${string}`,
        expiry,
        topics: [topic as `0x${string}`],
        data,
        proof: { type: 'sr25519', value: { signature: `0x${'00'.repeat(64)}`, signer: `0x${'00'.repeat(32)}` } },
      } as SignedStatement;
    }

    describe('fidelity', () => {
      it('accepts a new statement and returns it from a matching query', async () => {
        const store = createInMemoryStatementStore();
        await store.submitStatement(makeSignedStatement(hex(0xaa), 10n, hex(0x01), new Uint8Array([1])));

        const found = (await store.queryStatements({ matchAll: [new Uint8Array(32).fill(1)] }))._unsafeUnwrap();
        expect(found).toHaveLength(1);
        expect(found[0]?.expiry).toBe(10n);
      });

      it('replaces a same-channel statement only with a strictly higher expiry', async () => {
        const store = createInMemoryStatementStore();
        await store.submitStatement(makeSignedStatement(hex(0xaa), 10n, hex(0x01), new Uint8Array([1])));
        const higher = await store.submitStatement(makeSignedStatement(hex(0xaa), 11n, hex(0x01), new Uint8Array([2])));

        expect(higher.isOk()).toBe(true);
        expect(store.currentStatements()).toHaveLength(1);
        expect(store.currentStatements()[0]?.expiry).toBe(11n);
      });

      it('rejects a same-channel statement with equal or lower expiry (ExpiryTooLowError)', async () => {
        const store = createInMemoryStatementStore();
        await store.submitStatement(makeSignedStatement(hex(0xaa), 10n, hex(0x01), new Uint8Array([1])));

        const equal = await store.submitStatement(makeSignedStatement(hex(0xaa), 10n, hex(0x01), new Uint8Array([9])));
        const lower = await store.submitStatement(makeSignedStatement(hex(0xaa), 5n, hex(0x01), new Uint8Array([9])));

        expect(equal.isErr()).toBe(true);
        expect(equal._unsafeUnwrapErr()).toBeInstanceOf(ExpiryTooLowError);
        expect(lower.isErr()).toBe(true);
        // The original statement is untouched.
        expect(store.currentStatements()[0]?.data).toEqual(new Uint8Array([1]));
      });

      it('treats a byte-identical resubmission as known (ok, no duplicate)', async () => {
        const store = createInMemoryStatementStore();
        const stmt = makeSignedStatement(hex(0xaa), 10n, hex(0x01), new Uint8Array([1]));
        await store.submitStatement(stmt);
        const again = await store.submitStatement(stmt);

        expect(again.isOk()).toBe(true);
        expect(store.currentStatements()).toHaveLength(1);
      });

      it('coexists statements on different channels sharing a topic', async () => {
        const store = createInMemoryStatementStore();
        await store.submitStatement(makeSignedStatement(hex(0xaa), 10n, hex(0x01), new Uint8Array([1])));
        await store.submitStatement(makeSignedStatement(hex(0xbb), 10n, hex(0x01), new Uint8Array([2])));

        const found = (await store.queryStatements({ matchAll: [new Uint8Array(32).fill(1)] }))._unsafeUnwrap();
        expect(found).toHaveLength(2);
      });

      it('streams only post-subscription matching statements to live subscribers', async () => {
        const store = createInMemoryStatementStore();
        await store.submitStatement(makeSignedStatement(hex(0xaa), 10n, hex(0x01), new Uint8Array([1])));

        const pages: StatementsPage[] = [];
        store.subscribeStatements({ matchAll: [new Uint8Array(32).fill(1)] }, page => pages.push(page));

        // Pre-existing statement is NOT replayed; a new matching one is delivered.
        expect(pages).toHaveLength(0);
        await store.submitStatement(makeSignedStatement(hex(0xaa), 11n, hex(0x01), new Uint8Array([2])));
        expect(pages).toHaveLength(1);
        expect(pages[0]?.statements[0]?.expiry).toBe(11n);

        // A non-matching topic is not delivered.
        await store.submitStatement(makeSignedStatement(hex(0xcc), 10n, hex(0x02), new Uint8Array([3])));
        expect(pages).toHaveLength(1);
      });
    });

    describe('end-to-end flows (host ↔ mobile over a shared store)', () => {
      it('completes a request → ACK → reply → ACK round trip', async () => {
        const store = createInMemoryStatementStore();
        const host = makeHost(store);
        const mobile = makeMobile(store);

        // Mobile acknowledges every incoming request and, on seeing the host's
        // request, sends its application reply back as a new request.
        mobile.respondToRequests(RemoteMsg, () => 'success');
        const mobileGotRequest = mobile.waitForRequestMessage(RemoteMsg, msg =>
          msg.kind === 'request' ? msg : undefined,
        );
        // Host acknowledges the mobile's reply.
        host.respondToRequests(RemoteMsg, () => 'success');
        await settle();

        const hostAck = host.request(RemoteMsg, { id: 'h1', kind: 'request', respondingTo: '', body: 'sign this' });
        const mobileReplyAck = mobileGotRequest.andThen(req =>
          mobile.request(RemoteMsg, { id: 'm1', kind: 'reply', respondingTo: req.id, body: 'signature' }),
        );
        const hostReply = host.waitForRequestMessage(RemoteMsg, msg =>
          msg.kind === 'reply' && msg.respondingTo === 'h1' ? msg.body : undefined,
        );
        await settle();

        expect((await hostAck).isOk()).toBe(true); // mobile ACKed the host request
        expect((await mobileReplyAck).isOk()).toBe(true); // host ACKed the mobile reply
        expect((await hostReply)._unsafeUnwrap()).toBe('signature'); // host received the reply

        host.dispose();
        mobile.dispose();
      });

      it('answers an incoming request that went unanswered until a restart', async () => {
        const store = createInMemoryStatementStore();
        const host = makeHost(store);

        // Host must be listening to receive the eventual ACK.
        host.respondToRequests(RemoteMsg, () => 'success');
        // Mobile receives the request but never responds (no responder registered).
        let mobile = makeMobile(store);
        mobile.subscribe(RemoteMsg, () => undefined); // activate the store subscription, but do not ACK
        await settle();

        const hostAck = host.request(RemoteMsg, { id: 'h1', kind: 'request', respondingTo: '', body: 'sign this' });
        await settle();

        const beforeRestart = await Promise.race([
          Promise.resolve(hostAck).then(() => 'resolved'),
          new Promise<string>(resolve => setTimeout(() => resolve('pending'), 20)),
        ]);
        expect(beforeRestart).toBe('pending'); // unanswered while the responder is absent

        // Restart: a fresh mobile session on the same store rediscovers the
        // unanswered request via init() and now answers it.
        mobile.dispose();
        mobile = makeMobile(store);
        mobile.respondToRequests(RemoteMsg, () => 'success');
        await settle();

        expect((await hostAck).isOk()).toBe(true);

        host.dispose();
        mobile.dispose();
      });

      it('delivers the mobile reply to the host independently of the request ACK', async () => {
        // The application reply (waitForRequestMessage) and the transport ACK (request →
        // waitForResponseMessage) are independent channels. Here the mobile sends ONLY the reply
        // and never ACKs the host request — the host must still receive the reply while its request
        // ACK stays outstanding.
        const store = createInMemoryStatementStore();
        const host = makeHost(store);
        const mobile = makeMobile(store);

        const mobileGotRequest = mobile.waitForRequestMessage(RemoteMsg, msg =>
          msg.kind === 'request' ? msg : undefined,
        );
        void mobileGotRequest.andThen(() =>
          // Fire-and-forget the reply (do not wait for the host to ACK it).
          mobile.submitRequestMessage(RemoteMsg, { id: 'm1', kind: 'reply', respondingTo: 'h1', body: 'signature' }),
        );
        await settle();

        const hostReply = host.waitForRequestMessage(RemoteMsg, msg =>
          msg.kind === 'reply' && msg.respondingTo === 'h1' ? msg.body : undefined,
        );
        const hostAck = host.request(RemoteMsg, { id: 'h1', kind: 'request', respondingTo: '', body: 'sign this' });
        await settle();

        // The reply is delivered…
        expect((await hostReply)._unsafeUnwrap()).toBe('signature');
        // …while the transport ACK is still outstanding (mobile never sent it).
        const ackState = await Promise.race([
          Promise.resolve(hostAck).then(() => 'resolved'),
          new Promise<string>(resolve => setTimeout(() => resolve('pending'), 20)),
        ]);
        expect(ackState).toBe('pending');

        host.dispose();
        mobile.dispose();
      });
    });
  });
});
