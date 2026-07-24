import type { Encryption, StatementProver, StatementStoreAdapter } from '@novasamatech/statement-store';
import { createAccountId } from '@novasamatech/statement-store';
import type { StorageAdapter } from '@novasamatech/storage-adapter';
import { createMemoryAdapter } from '@novasamatech/storage-adapter';
import { ResultAsync, errAsync, okAsync } from 'neverthrow';
import { toHex } from 'polkadot-api/utils';
import { EMPTY } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// The statement-store session is the transport this wrapper sits on. It's the
// one seam doubled here, because these are unit tests of the wrapper's queue /
// ACK / ordering / dedup logic, which need to drive the transport into states a
// real session over the in-memory store can't produce — ACK errors, a reply
// that never arrives, a request that never ACKs, mid-flight abort. Everything
// else is real: the wrapper itself, real message ids (nanoid), and real
// storage / allowance / identity repositories over an in-memory adapter.
const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  waitForRequestMessage: vi.fn(),
  submitRequestMessage: vi.fn(),
  sessionSubscribe: vi.fn(),
  respondToRequests: vi.fn(),
  sessionDispose: vi.fn(),
  clearOutgoingStatement: vi.fn(),
}));

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

import { onHostPappDebugMessage } from '../src/debugBus.js';
import type { HostPappDebugEvent } from '../src/debugTypes.js';
import { createIdentityRepository } from '../src/identity/impl.js';
import type { Identity, IdentityAdapter, IdentityRepository } from '../src/identity/types.js';
import type { AllowanceRepository } from '../src/sso/allowance/index.js';
import { createAllowanceRepository } from '../src/sso/allowance/index.js';
import { createUserSession } from '../src/sso/sessionManager/userSession.js';
import type { StoredUserSession } from '../src/sso/userSessionRepository.js';

const SESSION_ID = 'user-session-1';
const IDENTITY_ACCOUNT_ID = new Uint8Array(32).fill(7);
// Storage key the wrapper uses for its processed-message dedup set (see userSession.ts).
const PROCESSED_KEY = `sso_processed_${SESSION_ID}`;

// An identity chain adapter with nothing on it: the repository wrapping it is
// real, so lookups just resolve to null.
const inertIdentityAdapter: IdentityAdapter = {
  readIdentities: () => okAsync({}),
  watchIdentity: () => EMPTY,
};

function captureEvents() {
  const events: HostPappDebugEvent[] = [];
  const unsubscribe = onHostPappDebugMessage(event => events.push(event));
  return { events, unsubscribe };
}

function makeStoredUserSession(): StoredUserSession {
  return {
    id: SESSION_ID,
    localAccount: { accountId: createAccountId(new Uint8Array(32)), kind: 'local' } as any,
    remoteAccount: {
      accountId: createAccountId(new Uint8Array(32)),
      publicKey: new Uint8Array(32),
      pin: undefined,
    },
    rootAccountId: createAccountId(new Uint8Array(32)),
    identityAccountId: createAccountId(IDENTITY_ACCOUNT_ID),
    identityChatPublicKey: new Uint8Array(65),
    ssoEncPubKey: new Uint8Array(65),
    rootEntropySource: new Uint8Array(32),
    deviceEncPubKey: new Uint8Array(65),
  };
}

function buildSession({
  allowanceRepository,
  identityRepository,
  storage = createMemoryAdapter(),
}: {
  allowanceRepository?: AllowanceRepository;
  identityRepository?: IdentityRepository;
  storage?: StorageAdapter;
} = {}) {
  return createUserSession({
    userSession: makeStoredUserSession(),
    // Transport + crypto are the statement-store session's concern, which is
    // mocked here (see top of file); these are inert placeholders.
    statementStore: {} as StatementStoreAdapter,
    encryption: {} as Encryption,
    prover: {} as StatementProver,
    storage,
    allowanceRepository: allowanceRepository ?? createAllowanceRepository('salt', createMemoryAdapter()),
    identityRepository: identityRepository ?? createIdentityRepository({ adapter: inertIdentityAdapter, storage }),
  });
}

beforeEach(() => {
  mocks.request.mockReset();
  mocks.waitForRequestMessage.mockReset();
  mocks.submitRequestMessage.mockReset().mockReturnValue(okAsync(undefined));
  mocks.sessionSubscribe.mockReset();
  mocks.respondToRequests.mockReset().mockReturnValue(vi.fn());
  mocks.sessionDispose.mockReset();
  mocks.clearOutgoingStatement.mockReset().mockReturnValue(okAsync(undefined));
});

describe('createUserSession readAllowance', () => {
  it('reads the slot key stored under the session id', async () => {
    const allowanceRepository = createAllowanceRepository('salt', createMemoryAdapter());
    const session = buildSession({ allowanceRepository });
    const key = new Uint8Array([1, 2, 3]);

    await allowanceRepository.write(session.id, 'product.dot', 'statementStore', key);

    await expect(session.readAllowance('product.dot', 'statementStore')).toBeOkWith(key);
  });

  it('returns null when nothing is stored', async () => {
    const session = buildSession();
    await expect(session.readAllowance('product.dot', 'bulletin')).toBeOkWith(null);
  });

  it('discriminates by productId and resource', async () => {
    const allowanceRepository = createAllowanceRepository('salt', createMemoryAdapter());
    const session = buildSession({ allowanceRepository });
    const keyA = new Uint8Array([1, 1, 1]);
    const keyB = new Uint8Array([2, 2, 2]);

    await allowanceRepository.write(session.id, 'product.a', 'statementStore', keyA);
    await allowanceRepository.write(session.id, 'product.b', 'statementStore', keyB);

    await expect(session.readAllowance('product.a', 'statementStore')).toBeOkWith(keyA);
    await expect(session.readAllowance('product.b', 'statementStore')).toBeOkWith(keyB);
    // same product, other resource is a distinct slot
    await expect(session.readAllowance('product.a', 'bulletin')).toBeOkWith(null);
  });
});

describe('createUserSession getIdentity', () => {
  const identity: Identity = {
    accountId: toHex(IDENTITY_ACCOUNT_ID),
    fullUsername: null,
    liteUsername: 'alice',
    credibility: { type: 'Lite' },
  };

  it('looks up the session identity account (hex) and forwards the result', async () => {
    // Adapter answers only for the exact hex of the session's identity account,
    // so a passing lookup proves the wrapper queries the right account.
    const identityRepository = createIdentityRepository({
      adapter: {
        readIdentities: accounts =>
          okAsync(Object.fromEntries(accounts.map(a => [a, a === toHex(IDENTITY_ACCOUNT_ID) ? identity : null]))),
        watchIdentity: () => EMPTY,
      },
      storage: createMemoryAdapter(),
    });
    const session = buildSession({ identityRepository });

    await expect(session.getIdentity()).toBeOkWith(identity);
  });

  it('propagates a null identity', async () => {
    const session = buildSession();
    await expect(session.getIdentity()).toBeOkWith(null);
  });
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
        await expect(session.signPayload({} as any)).toBeOk();

        const hostEventNames = events
          .filter(e => e.layer === 'session' && e.event.startsWith('host_action'))
          .map(e => e.event);
        expect(hostEventNames).toEqual(['host_action_sent', 'host_action_response_received']);
        // Both events carry the one message id the wrapper generated for this call.
        const sent = events.find(e => e.event === 'host_action_sent');
        const received = events.find(e => e.event === 'host_action_response_received');
        expect(sent).toBeDefined();
        expect(received?.flowId).toBe(sent?.flowId);
        expect(sent?.payload).toMatchObject({
          sessionId: SESSION_ID,
          messageId: sent?.flowId,
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
        await expect(session.signPayload({} as any)).toBeErr();

        const sent = events.find(e => e.event === 'host_action_sent');
        const failed = events.find(e => e.event === 'host_action_failed');
        expect(sent).toBeDefined();
        expect(failed).toMatchObject({
          flowId: sent?.flowId,
          payload: { sessionId: SESSION_ID, messageId: sent?.flowId, reason: 'peer rejected' },
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
        await expect(session.signRawLegacy({} as any)).toBeOkWith(signature);
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
      await expect(session.createTransactionLegacy({} as any)).toBeOkWith(signedTransaction);
    });

    it('getRingVrfAlias emits host_action_sent with actionKind RingVrfAliasRequest', async () => {
      mocks.request.mockReturnValue(okAsync(undefined));
      mocks.waitForRequestMessage.mockReturnValue(okAsync({ success: true, value: new Uint8Array() as any }));

      const session = buildSession();
      const { events, unsubscribe } = captureEvents();
      try {
        await session.getRingVrfAlias('caller.dot', ['product.alpha', { tag: 'Index', value: 0 }], {
          chainId: '0x22',
          junctions: [{ tag: 'PalletInstance', value: 42 }],
        });
        expect(events.find(e => e.event === 'host_action_sent')?.payload).toMatchObject({
          actionKind: 'RingVrfAliasRequest',
        });
      } finally {
        unsubscribe();
      }
    });

    it('createRingVrfProof emits host_action_sent with actionKind RingVrfProofRequest', async () => {
      mocks.request.mockReturnValue(okAsync(undefined));
      mocks.waitForRequestMessage.mockReturnValue(okAsync({ success: true, value: new Uint8Array() as any }));

      const session = buildSession();
      const { events, unsubscribe } = captureEvents();
      try {
        await session.createRingVrfProof(
          'caller.dot',
          ['product.alpha', { tag: 'Index', value: 0 }],
          { chainId: '0x22', junctions: [{ tag: 'PalletInstance', value: 42 }] },
          new Uint8Array([1, 2, 3]),
        );
        expect(events.find(e => e.event === 'host_action_sent')?.payload).toMatchObject({
          actionKind: 'RingVrfProofRequest',
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
      const storage = createMemoryAdapter();
      await storage.write(PROCESSED_KEY, JSON.stringify(['peer-msg-dup']));

      const session = buildSession({ storage });
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
      const storage = createMemoryAdapter();
      await storage.write(PROCESSED_KEY, JSON.stringify(['peer-msg-3']));

      const session = buildSession({ storage });
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
    await expect(session.signPayload({} as any)).toBeOk();
  }, 2000);

  it('fails fast when the request ACK errors even if no reply ever arrives', async () => {
    mocks.request.mockReturnValue(errAsync(new Error('decoding failed')));
    mocks.waitForRequestMessage.mockReturnValue(ResultAsync.fromSafePromise(new Promise(() => undefined))); // reply never

    const session = buildSession();
    await expect(session.signPayload({} as any)).toBeErr();
  }, 2000);
});

describe('createUserSession abortPendingRequests', () => {
  it('delegates to the session clearOutgoingStatement and resolves ok', async () => {
    const session = buildSession();

    await expect(session.abortPendingRequests()).toBeOk();

    expect(mocks.clearOutgoingStatement).toHaveBeenCalledTimes(1);
  });

  it('propagates a clearOutgoingStatement failure', async () => {
    mocks.clearOutgoingStatement.mockReturnValue(errAsync(new Error('boom')));
    const session = buildSession();

    await expect(session.abortPendingRequests()).toBeErr();
  });

  it('rejects the in-flight and queued signing requests, freeing the queue', async () => {
    mocks.request.mockReturnValue(okAsync(undefined));
    // Never resolves on its own — the request stays in flight until aborted.
    mocks.waitForRequestMessage.mockReturnValue(ResultAsync.fromSafePromise(new Promise(() => undefined)));

    const session = buildSession();
    const inFlight = session.signPayload({} as any); // takes the single slot
    const queued = session.signRaw({} as any); // waits behind it

    await session.abortPendingRequests();

    const [inFlightResult, queuedResult] = await Promise.all([inFlight, queued]);
    await expect(inFlightResult).toBeErr();
    await expect(queuedResult).toBeErr();
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
    await expect(aborted).toBeErr();
    resolveFirst?.(); // settle the orphaned inner waiter so it doesn't dangle

    await expect(session.signPayload({} as any)).toBeOk();
  });
});
