import type { Encryption, StatementProver, StatementStoreAdapter } from '@novasamatech/statement-store';
import type { StorageAdapter } from '@novasamatech/storage-adapter';
import { ResultAsync, errAsync, okAsync } from 'neverthrow';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  waitForRequestMessage: vi.fn(),
  submitRequestMessage: vi.fn(),
  sessionSubscribe: vi.fn(),
  respondToRequests: vi.fn(),
  sessionDispose: vi.fn(),
  clearOutgoingStatement: vi.fn(),
  fieldListRead: vi.fn(),
  fieldListMutate: vi.fn(),
  nanoid: vi.fn(),
}));

vi.mock('nanoid', () => ({ nanoid: mocks.nanoid }));

vi.mock('@novasamatech/statement-store', async importOriginal => {
  const actual = await importOriginal<typeof import('@novasamatech/statement-store')>();
  return {
    ...actual,
    createSession: vi.fn(() => ({
      request: mocks.request,
      waitForRequestMessage: mocks.waitForRequestMessage,
      submitRequestMessage: mocks.submitRequestMessage,
      subscribe: mocks.sessionSubscribe,
      respondToRequests: mocks.respondToRequests,
      dispose: mocks.sessionDispose,
      clearOutgoingStatement: mocks.clearOutgoingStatement,
    })),
  };
});

vi.mock('@novasamatech/storage-adapter', async importOriginal => {
  const actual = await importOriginal<typeof import('@novasamatech/storage-adapter')>();
  return {
    ...actual,
    fieldListView: vi.fn(() => ({
      read: mocks.fieldListRead,
      mutate: mocks.fieldListMutate,
    })),
  };
});

import { onHostPappDebugMessage } from '../src/debugBus.js';
import type { HostPappDebugEvent } from '../src/debugTypes.js';
import { createUserSession } from '../src/sso/sessionManager/userSession.js';
import type { StoredUserSession } from '../src/sso/userSessionRepository.js';

const SESSION_ID = 'user-session-1';
const MSG_ID = 'msg-fixed';

function captureEvents() {
  const events: HostPappDebugEvent[] = [];
  const unsubscribe = onHostPappDebugMessage(event => events.push(event));
  return { events, unsubscribe };
}

function makeStoredUserSession(): StoredUserSession {
  return {
    id: SESSION_ID,
    localAccount: { accountId: new Uint8Array(32), kind: 'local' } as any,
    remoteAccount: { accountId: new Uint8Array(32), publicKey: new Uint8Array(32), kind: 'remote' } as any,
    rootAccountId: new Uint8Array(32) as any,
  } as StoredUserSession;
}

function buildSession() {
  return createUserSession({
    userSession: makeStoredUserSession(),
    statementStore: {} as StatementStoreAdapter,
    encryption: {} as Encryption,
    storage: {} as StorageAdapter,
    prover: {} as StatementProver,
  });
}

beforeEach(() => {
  mocks.nanoid.mockReset().mockReturnValue(MSG_ID);
  mocks.request.mockReset();
  mocks.waitForRequestMessage.mockReset();
  mocks.submitRequestMessage.mockReset().mockReturnValue(okAsync(undefined));
  mocks.sessionSubscribe.mockReset();
  mocks.respondToRequests.mockReset().mockReturnValue(vi.fn());
  mocks.sessionDispose.mockReset();
  mocks.clearOutgoingStatement.mockReset().mockReturnValue(okAsync(undefined));
  mocks.fieldListRead.mockReset().mockReturnValue(okAsync([]));
  mocks.fieldListMutate.mockReset().mockReturnValue(okAsync(undefined));
});

// Regression coverage: every debug emit site in userSession.ts should fire
// when the corresponding code path runs. If a future refactor drops an emit,
// the matching assertion below fails.
describe('createUserSession debug emits', () => {
  describe('host actions', () => {
    it('signPayload emits host_action_sent then host_action_response_received on success', async () => {
      mocks.request.mockReturnValue(okAsync(undefined));
      mocks.waitForRequestMessage.mockReturnValue(
        okAsync({ success: true, value: { signed: new Uint8Array() } as any }),
      );

      const session = buildSession();
      const { events, unsubscribe } = captureEvents();
      try {
        const result = await session.signPayload({} as any);
        expect(result.isOk()).toBe(true);

        const hostEvents = events
          .filter(e => e.layer === 'session' && e.event.startsWith('host_action'))
          .map(e => ({ event: e.event, flowId: e.flowId }));
        expect(hostEvents).toEqual([
          { event: 'host_action_sent', flowId: MSG_ID },
          { event: 'host_action_response_received', flowId: MSG_ID },
        ]);
        const sent = events.find(e => e.event === 'host_action_sent');
        expect(sent?.payload).toMatchObject({
          sessionId: SESSION_ID,
          messageId: MSG_ID,
          actionKind: 'SignRequest:Payload',
        });
      } finally {
        unsubscribe();
      }
    });

    it('signPayload emits host_action_failed when the request rejects', async () => {
      mocks.request.mockReturnValue(errAsync(new Error('peer rejected')));
      // Reply never arrives — the ACK error must fast-fail the call on its own.
      mocks.waitForRequestMessage.mockReturnValue(ResultAsync.fromSafePromise(new Promise(() => undefined)));

      const session = buildSession();
      const { events, unsubscribe } = captureEvents();
      try {
        const result = await session.signPayload({} as any);
        expect(result.isErr()).toBe(true);

        const sent = events.find(e => e.event === 'host_action_sent');
        const failed = events.find(e => e.event === 'host_action_failed');
        expect(sent).toBeDefined();
        expect(failed).toMatchObject({
          flowId: MSG_ID,
          payload: { sessionId: SESSION_ID, messageId: MSG_ID, reason: 'peer rejected' },
        });
      } finally {
        unsubscribe();
      }
    });

    it('signRaw emits host_action_sent with actionKind SignRequest:Raw', async () => {
      mocks.request.mockReturnValue(okAsync(undefined));
      mocks.waitForRequestMessage.mockReturnValue(
        okAsync({ success: true, value: { signed: new Uint8Array() } as any }),
      );

      const session = buildSession();
      const { events, unsubscribe } = captureEvents();
      try {
        await session.signRaw({} as any);
        expect(events.find(e => e.event === 'host_action_sent')?.payload).toMatchObject({
          actionKind: 'SignRequest:Raw',
        });
      } finally {
        unsubscribe();
      }
    });

    it('signRawLegacy emits host_action_sent with actionKind SignRawLegacyRequest and resolves with the signature', async () => {
      mocks.request.mockReturnValue(okAsync(undefined));
      const signature = new Uint8Array([1, 2, 3]);
      mocks.waitForRequestMessage.mockReturnValue(okAsync({ success: true, value: signature }));

      const session = buildSession();
      const { events, unsubscribe } = captureEvents();
      try {
        const result = await session.signRawLegacy({} as any);
        expect(result.isOk()).toBe(true);
        expect(result._unsafeUnwrap()).toBe(signature);
        expect(events.find(e => e.event === 'host_action_sent')?.payload).toMatchObject({
          actionKind: 'SignRawLegacyRequest',
        });
      } finally {
        unsubscribe();
      }
    });

    it('createTransactionLegacy resolves with the signed transaction from a CreateTransactionResponse', async () => {
      mocks.request.mockReturnValue(okAsync(undefined));
      const signedTransaction = new Uint8Array([4, 5, 6]);
      mocks.waitForRequestMessage.mockReturnValue(okAsync({ success: true, value: signedTransaction }));

      const session = buildSession();
      const result = await session.createTransactionLegacy({} as any);
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toBe(signedTransaction);
    });

    it('getRingVrfAlias emits host_action_sent with actionKind RingVrfAliasRequest', async () => {
      mocks.request.mockReturnValue(okAsync(undefined));
      mocks.waitForRequestMessage.mockReturnValue(okAsync({ success: true, value: new Uint8Array() as any }));

      const session = buildSession();
      const { events, unsubscribe } = captureEvents();
      try {
        await session.getRingVrfAlias(new Uint8Array(32) as any, 'product.alpha');
        expect(events.find(e => e.event === 'host_action_sent')?.payload).toMatchObject({
          actionKind: 'RingVrfAliasRequest',
        });
      } finally {
        unsubscribe();
      }
    });
  });

  describe('peer actions', () => {
    function makePeerMessage(messageId: string, innerTag: string) {
      return {
        type: 'request',
        requestId: messageId,
        payload: {
          status: 'parsed',
          value: {
            messageId,
            data: { tag: 'v1', value: { tag: innerTag, value: undefined } },
          },
        },
      } as any;
    }

    function makeUndecodableMessage(requestId: string) {
      return {
        type: 'request',
        requestId,
        payload: { status: 'failed', value: new Uint8Array([1, 2, 3]) },
      } as any;
    }

    // The consumer drives auto-ACK through session.respondToRequests: its handler
    // returns the transport-level ResponseStatus the session submits on our behalf.
    function captureResponder() {
      let handler: ((message: any) => unknown) | undefined;
      mocks.respondToRequests.mockImplementation((_codec, h) => {
        handler = h;
        return vi.fn();
      });
      return () => handler!;
    }

    const flush = () => new Promise(resolve => setImmediate(resolve));

    it('auto-ACKs a decoded incoming request with success', async () => {
      const getHandler = captureResponder();
      const session = buildSession();
      const { unsubscribe } = captureEvents();
      try {
        session.subscribe(vi.fn(() => okAsync(true)));
        const status = getHandler()(makePeerMessage('peer-msg-ack', 'Disconnected'));
        expect(status).toBe('success');
      } finally {
        unsubscribe();
      }
    });

    it('auto-ACKs a peer reply (e.g. SignResponse) with success even though the subscribe callback ignores it', async () => {
      // Mirrors impl.ts: the consumer callback acts only on Disconnected and returns false
      // (a no-op) for every reply. That false must NOT gate the transport ACK.
      const getHandler = captureResponder();
      const session = buildSession();
      const { unsubscribe } = captureEvents();
      try {
        session.subscribe(vi.fn(() => okAsync(false)));
        const status = getHandler()(makePeerMessage('reply-1', 'SignResponse'));
        expect(status).toBe('success');
      } finally {
        unsubscribe();
      }
    });

    it('auto-ACKs an undecodable incoming request with decodingFailed', async () => {
      const getHandler = captureResponder();
      const session = buildSession();
      const { unsubscribe } = captureEvents();
      try {
        session.subscribe(vi.fn(() => okAsync(true)));
        const status = getHandler()(makeUndecodableMessage('peer-msg-bad'));
        expect(status).toBe('decodingFailed');
      } finally {
        unsubscribe();
      }
    });

    it('re-ACKs an already-processed request with success without re-running the callback', async () => {
      const getHandler = captureResponder();
      mocks.fieldListRead.mockReturnValue(okAsync(['peer-msg-dup']));

      const session = buildSession();
      const { events, unsubscribe } = captureEvents();
      try {
        const callback = vi.fn(() => okAsync(true));
        session.subscribe(callback);

        // The peer retransmitted because it never saw our ACK: we MUST ACK again,
        // but the side effects (callback, debug emits) must not re-run.
        const status = getHandler()(makePeerMessage('peer-msg-dup', 'Disconnected'));
        await flush();

        expect(status).toBe('success');
        expect(callback).not.toHaveBeenCalled();
        expect(events.filter(e => e.layer === 'session')).toHaveLength(0);
      } finally {
        unsubscribe();
      }
    });

    it('emits peer_action_received and peer_action_processed when the callback returns true', async () => {
      const getHandler = captureResponder();
      const session = buildSession();
      const { events, unsubscribe } = captureEvents();
      try {
        const callback = vi.fn(() => okAsync(true));
        session.subscribe(callback);
        getHandler()(makePeerMessage('peer-msg-1', 'Disconnected'));

        await flush();

        const received = events.find(e => e.event === 'peer_action_received');
        const processed = events.find(e => e.event === 'peer_action_processed');
        expect(received).toMatchObject({
          flowId: 'peer-msg-1',
          payload: { sessionId: SESSION_ID, messageId: 'peer-msg-1', actionKind: 'Disconnected' },
        });
        expect(processed).toMatchObject({
          flowId: 'peer-msg-1',
          payload: { sessionId: SESSION_ID, messageId: 'peer-msg-1' },
        });
      } finally {
        unsubscribe();
      }
    });

    it('emits peer_action_failed when the callback errors', async () => {
      const getHandler = captureResponder();
      // silence the console.error from the production code's orTee
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(vi.fn());

      const session = buildSession();
      const { events, unsubscribe } = captureEvents();
      try {
        const callback = vi.fn(() => errAsync(new Error('handler boom')) as unknown as ResultAsync<boolean, Error>);
        session.subscribe(callback);
        getHandler()(makePeerMessage('peer-msg-2', 'Disconnected'));

        await flush();

        const received = events.find(e => e.event === 'peer_action_received');
        const failed = events.find(e => e.event === 'peer_action_failed');
        expect(received).toBeDefined();
        expect(failed).toMatchObject({
          flowId: 'peer-msg-2',
          payload: { sessionId: SESSION_ID, messageId: 'peer-msg-2', reason: 'handler boom' },
        });
      } finally {
        unsubscribe();
        errorSpy.mockRestore();
      }
    });

    it('does not emit anything for messages that were already processed in a previous run', async () => {
      const getHandler = captureResponder();
      mocks.fieldListRead.mockReturnValue(okAsync(['peer-msg-3']));

      const session = buildSession();
      const { events, unsubscribe } = captureEvents();
      try {
        const callback = vi.fn(() => okAsync(true));
        session.subscribe(callback);
        getHandler()(makePeerMessage('peer-msg-3', 'Disconnected'));

        await flush();

        expect(events.filter(e => e.layer === 'session')).toHaveLength(0);
        expect(callback).not.toHaveBeenCalled();
      } finally {
        unsubscribe();
      }
    });
  });
});

describe('createUserSession request/reply ordering', () => {
  // The transport ACK (session.request) and the peer's application reply
  // (waitForRequestMessage) are independent channels with non-deterministic
  // arrival order. The reply must not be gated on the ACK, otherwise a lost or
  // late ACK wedges the call for the full queue timeout even though the answer
  // already arrived.
  it('resolves from the peer reply without waiting for the request ACK', async () => {
    mocks.request.mockReturnValue(ResultAsync.fromSafePromise(new Promise<void>(() => undefined))); // ACK never resolves
    mocks.waitForRequestMessage.mockReturnValue(
      okAsync({ success: true, value: { signature: new Uint8Array() } as any }),
    );

    const session = buildSession();
    const result = await session.signPayload({} as any);
    expect(result.isOk()).toBe(true);
  }, 2000);

  it('fails fast when the request ACK errors even if no reply ever arrives', async () => {
    mocks.request.mockReturnValue(errAsync(new Error('decoding failed')));
    mocks.waitForRequestMessage.mockReturnValue(ResultAsync.fromSafePromise(new Promise(() => undefined))); // reply never

    const session = buildSession();
    const result = await session.signPayload({} as any);
    expect(result.isErr()).toBe(true);
  }, 2000);
});

describe('createUserSession abortPendingRequests', () => {
  it('delegates to the session clearOutgoingStatement and resolves ok', async () => {
    const session = buildSession();

    const result = await session.abortPendingRequests();

    expect(mocks.clearOutgoingStatement).toHaveBeenCalledTimes(1);
    expect(result.isOk()).toBe(true);
  });

  it('propagates a clearOutgoingStatement failure', async () => {
    mocks.clearOutgoingStatement.mockReturnValue(errAsync(new Error('boom')));
    const session = buildSession();

    const result = await session.abortPendingRequests();

    expect(result.isErr()).toBe(true);
  });

  it('rejects the in-flight and queued signing requests, freeing the queue', async () => {
    mocks.nanoid.mockReturnValueOnce('in-flight').mockReturnValueOnce('queued');
    mocks.request.mockReturnValue(okAsync(undefined));
    // Never resolves on its own — the request stays in flight until aborted.
    mocks.waitForRequestMessage.mockReturnValue(ResultAsync.fromSafePromise(new Promise(() => undefined)));

    const session = buildSession();
    const inFlight = session.signPayload({} as any); // takes the single slot
    const queued = session.signRaw({} as any); // waits behind it

    await session.abortPendingRequests();

    const [inFlightResult, queuedResult] = await Promise.all([inFlight, queued]);
    expect(inFlightResult.isErr()).toBe(true);
    expect(queuedResult.isErr()).toBe(true);
    expect(mocks.clearOutgoingStatement).toHaveBeenCalledTimes(1);
  });

  it('lets a fresh request through after an abort', async () => {
    mocks.request.mockReturnValue(okAsync(undefined));
    let resolveFirst: (() => void) | undefined;
    mocks.waitForRequestMessage
      .mockReturnValueOnce(
        ResultAsync.fromSafePromise(new Promise<any>(resolve => (resolveFirst = () => resolve(undefined)))),
      )
      .mockReturnValue(okAsync({ success: true, value: { signed: new Uint8Array() } as any }));

    const session = buildSession();
    const aborted = session.signPayload({} as any);
    await session.abortPendingRequests();
    expect((await aborted).isErr()).toBe(true);
    resolveFirst?.(); // settle the orphaned inner waiter so it doesn't dangle

    const result = await session.signPayload({} as any);
    expect(result.isOk()).toBe(true);
  });
});
