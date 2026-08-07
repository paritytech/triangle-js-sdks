import { enumValue } from '@novasamatech/scale';
import type { StatementStoreAdapter } from '@novasamatech/statement-store';
import {
  DecodingError,
  StatementData,
  createAccountId,
  createEncryption,
  createInMemoryStatementStore,
} from '@novasamatech/statement-store';
import { createMemoryAdapter } from '@novasamatech/storage-adapter';
import type { ResultAsync } from 'neverthrow';
import { errAsync, okAsync } from 'neverthrow';
import { toHex } from 'polkadot-api/utils';
import { describe, expect, it, vi } from 'vitest';

import { onHostPappDebugMessage } from '../src/debugBus.js';
import type { HostPappDebugEvent } from '../src/debugTypes.js';
import { createIdentityRepository } from '../src/identity/impl.js';
import type { Identity } from '../src/identity/types.js';
import { createAllowanceRepository } from '../src/sso/allowance/index.js';
import type { RemoteMessage } from '../src/sso/sessionManager/scale/remoteMessage.js';
import { processedMessagesKey } from '../src/sso/sessionManager/userSession.js';

import { createPairedUserSession, flush } from './peerSession.js';

const SESSION_ID = 'user-session-1';
const IDENTITY_ACCOUNT_ID = new Uint8Array(32).fill(7);
const PROCESSED_KEY = processedMessagesKey(SESSION_ID);

// An identity chain adapter with nothing on it: the repository wrapping it is
// real, so lookups just resolve to null.

function captureEvents() {
  const events: HostPappDebugEvent[] = [];
  const unsubscribe = onHostPappDebugMessage(event => events.push(event));
  return { events, unsubscribe };
}

// The wrapper over a real statement-store session, paired with the peer half of
// that session over the same in-memory store. Nothing is doubled: what the peer
// submits, the wrapper receives, and vice versa.
const buildSession = (overrides: Parameters<typeof createPairedUserSession>[0] = {}) =>
  createPairedUserSession({ id: SESSION_ID, identityAccountId: IDENTITY_ACCOUNT_ID, ...overrides });

const bytes = (...values: number[]) => new Uint8Array(values);

// How many messages each outgoing request batch carries, oldest first — the
// empty batch is how `clearOutgoingStatement` evicts the live one.
const requestBatchSizes = (store: ReturnType<typeof createInMemoryStatementStore>, sharedSecret: Uint8Array) =>
  store.acceptedStatements().flatMap(statement => {
    const decrypted = createEncryption(sharedSecret).decrypt(statement.data!)._unsafeUnwrap();
    const decoded = StatementData.dec(decrypted);

    return decoded.tag === 'request' ? [decoded.value.data.length] : [];
  });

// The v1 variant tags of everything the peer has received so far.
const peerRequestTags = (peer: { received: RemoteMessage[] }) =>
  peer.received.map(m => (m.data.tag === 'v1' ? m.data.value.tag : m.data.tag));

const signPayloadRequest = {
  productAccountId: ['product.dot', { tag: 'Index' as const, value: 0 }] as const,
  blockHash: '0x00',
  blockNumber: '0x01',
  era: '0x00',
  genesisHash: '0x00',
  method: '0x00',
  nonce: '0x00',
  specVersion: '0x00',
  tip: '0x00',
  transactionVersion: '0x00',
  signedExtensions: [],
  version: 4,
  assetId: undefined,
  metadataHash: undefined,
  mode: undefined,
  withSignedTransaction: undefined,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any;

const signRawRequest = {
  productAccountId: ['product.dot', { tag: 'Index', value: 0 }],
  data: enumValue('Bytes', bytes(1, 2, 3)),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any;

const signRawLegacyRequest = {
  account: createAccountId(new Uint8Array(32).fill(4)),
  data: enumValue('Bytes', bytes(1, 2, 3)),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any;

const legacyTransactionRequest = {
  payload: enumValue('v1', {
    signer: createAccountId(new Uint8Array(32).fill(4)),
    genesisHash: '0x00',
    callData: bytes(1),
    extensions: [],
    txExtVersion: 0,
  }),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any;

// The canonical success reply to whatever the host just sent, as the paired app
// would answer it. Only the variants these tests await are covered.
function successReply(request: RemoteMessage) {
  const respondingTo = request.messageId;
  if (request.data.tag !== 'v1') throw new Error('unexpected message version');

  switch (request.data.value.tag) {
    case 'SignRequest':
      return enumValue('SignResponse', {
        respondingTo,
        payload: { success: true as const, value: { signature: bytes(9), signedTransaction: undefined } },
      });
    case 'SignRawLegacyRequest':
      return enumValue('SignRawLegacyResponse', {
        respondingTo,
        signature: { success: true as const, value: bytes(1, 2, 3) },
      });
    case 'CreateTransactionLegacyRequest':
      return enumValue('CreateTransactionResponse', {
        respondingTo,
        signedTransaction: { success: true as const, value: bytes(4, 5, 6) },
      });
    default:
      throw new Error(`no canned reply for ${request.data.value.tag}`);
  }
}

describe('createUserSession readAllowance', () => {
  it('reads the slot key stored under the session id', async () => {
    const allowanceRepository = createAllowanceRepository('salt', createMemoryAdapter());
    const { session } = buildSession({ allowanceRepository });
    const key = new Uint8Array([1, 2, 3]);

    await allowanceRepository.write(session.id, 'product.dot', 'statementStore', key);

    await expect(session.readAllowance('product.dot', 'statementStore')).toBeOkWith(key);
  });

  it('returns null when nothing is stored', async () => {
    const { session } = buildSession();
    await expect(session.readAllowance('product.dot', 'bulletin')).toBeOkWith(null);
  });

  it('discriminates by productId and resource', async () => {
    const allowanceRepository = createAllowanceRepository('salt', createMemoryAdapter());
    const { session } = buildSession({ allowanceRepository });
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
    identifierKey: toHex(IDENTITY_ACCOUNT_ID),
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
    const { session } = buildSession({ identityRepository });

    await expect(session.getIdentity()).toBeOkWith(identity);
  });

  it('propagates a null identity', async () => {
    const { session } = buildSession();
    await expect(session.getIdentity()).toBeOkWith(null);
  });
});

// Regression coverage: every debug emit site in userSession.ts should fire
// when the corresponding code path runs. If a future refactor drops an emit,
// the matching assertion below fails.
describe('createUserSession debug emits', () => {
  describe('host actions', () => {
    it('signPayload emits host_action_sent then host_action_response_received on success', async () => {
      const { session, peer } = buildSession();
      peer.answerWith(successReply);
      peer.ackWith('success');
      const { events, unsubscribe } = captureEvents();
      try {
        await expect(session.signPayload(signPayloadRequest)).toBeOk();

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

    it('signPayload emits host_action_failed when the peer NACKs', async () => {
      // No reply is ever built — the NACK must fast-fail the call on its own.
      const { session, peer } = buildSession();
      peer.ackWith('decodingFailed');
      const { events, unsubscribe } = captureEvents();
      try {
        await expect(session.signPayload(signPayloadRequest)).toBeErr();

        const sent = events.find(e => e.event === 'host_action_sent');
        const failed = events.find(e => e.event === 'host_action_failed');
        expect(sent).toBeDefined();
        expect(failed).toMatchObject({
          flowId: sent?.flowId,
          payload: { sessionId: SESSION_ID, messageId: sent?.flowId, reason: new DecodingError().message },
        });
      } finally {
        unsubscribe();
      }
    });

    it('signRaw emits host_action_sent with actionKind SignRequest:Raw', async () => {
      const { session, peer } = buildSession();
      const { events, unsubscribe } = captureEvents();
      try {
        // The emit fires as the request goes out; a silent peer keeps the call
        // pending, which is exactly what these label assertions care about.
        void session.signRaw(signRawRequest);
        await flush();
        expect(events.find(e => e.event === 'host_action_sent')?.payload).toMatchObject({
          actionKind: 'SignRequest:Raw',
        });
        // The emit is only honest if the message really went out.
        expect(peerRequestTags(peer)).toContain('SignRequest');
      } finally {
        unsubscribe();
      }
    });

    it('signRawLegacy emits host_action_sent with actionKind SignRawLegacyRequest and resolves with the signature', async () => {
      const { session, peer } = buildSession();
      peer.answerWith(successReply);
      peer.ackWith('success');
      const { events, unsubscribe } = captureEvents();
      try {
        await expect(session.signRawLegacy(signRawLegacyRequest)).toBeOkWith(bytes(1, 2, 3));
        expect(events.find(e => e.event === 'host_action_sent')?.payload).toMatchObject({
          actionKind: 'SignRawLegacyRequest',
        });
      } finally {
        unsubscribe();
      }
    });

    it('createTransactionLegacy resolves with the signed transaction from a CreateTransactionResponse', async () => {
      const { session, peer } = buildSession();
      peer.answerWith(successReply);
      peer.ackWith('success');

      await expect(session.createTransactionLegacy(legacyTransactionRequest)).toBeOkWith(bytes(4, 5, 6));
    });

    it('getRingVrfAlias emits host_action_sent with actionKind RingVrfAliasRequest', async () => {
      const { session, peer } = buildSession();
      const { events, unsubscribe } = captureEvents();
      try {
        void session.getRingVrfAlias(
          'caller.dot',
          ['peopl.dot', { tag: 'Index', value: 0 }],
          ['product.alpha', { tag: 'Index', value: 0 }],
          {
            chainId: '0x22',
            junctions: [{ tag: 'PalletInstance', value: 42 }],
          },
        );
        await flush();
        expect(events.find(e => e.event === 'host_action_sent')?.payload).toMatchObject({
          actionKind: 'RingVrfAliasRequest',
        });
        // The emit is only honest if the message really went out.
        expect(peerRequestTags(peer)).toContain('RingVrfAliasRequest');
      } finally {
        unsubscribe();
      }
    });

    it('createRingVrfProof emits host_action_sent with actionKind RingVrfProofRequest', async () => {
      const { session, peer } = buildSession();
      const { events, unsubscribe } = captureEvents();
      try {
        void session.createRingVrfProof(
          'caller.dot',
          ['peopl.dot', { tag: 'Index', value: 0 }],
          ['product.alpha', { tag: 'Index', value: 0 }],
          { chainId: '0x22', junctions: [{ tag: 'PalletInstance', value: 42 }] },
          new Uint8Array([1, 2, 3]),
        );
        await flush();
        expect(events.find(e => e.event === 'host_action_sent')?.payload).toMatchObject({
          actionKind: 'RingVrfProofRequest',
        });
        // The emit is only honest if the message really went out.
        expect(peerRequestTags(peer)).toContain('RingVrfProofRequest');
      } finally {
        unsubscribe();
      }
    });

    it('ringVrfSign emits host_action_sent with actionKind RingVrfSignRequest', async () => {
      const { session, peer } = buildSession();
      const { events, unsubscribe } = captureEvents();
      try {
        void session.ringVrfSign('caller.dot', ['peopl.dot', { tag: 'Index', value: 0 }], new Uint8Array([1, 2, 3]));
        await flush();
        expect(events.find(e => e.event === 'host_action_sent')?.payload).toMatchObject({
          actionKind: 'RingVrfSignRequest',
        });
        // The emit is only honest if the message really went out.
        expect(peerRequestTags(peer)).toContain('RingVrfSignRequest');
      } finally {
        unsubscribe();
      }
    });

    it('registerRingVrfKey emits host_action_sent with actionKind RegisterRingVrfKeyRequest', async () => {
      const { session, peer } = buildSession();
      const { events, unsubscribe } = captureEvents();
      try {
        void session.registerRingVrfKey(
          'peopl.dot',
          { tag: 'Index', value: 0 },
          {
            chainId: '0x22',
            junctions: [{ tag: 'PalletInstance', value: 42 }],
          },
        );
        await flush();
        expect(events.find(e => e.event === 'host_action_sent')?.payload).toMatchObject({
          actionKind: 'RegisterRingVrfKeyRequest',
        });
        // The emit is only honest if the message really went out.
        expect(peerRequestTags(peer)).toContain('RegisterRingVrfKeyRequest');
      } finally {
        unsubscribe();
      }
    });

    it('listRingVrfKeys emits host_action_sent with actionKind ListRingVrfKeysRequest', async () => {
      const { session, peer } = buildSession();
      const { events, unsubscribe } = captureEvents();
      try {
        void session.listRingVrfKeys('game.dot', 'peopl.dot', 'Anonymized');
        await flush();
        expect(events.find(e => e.event === 'host_action_sent')?.payload).toMatchObject({
          actionKind: 'ListRingVrfKeysRequest',
        });
        // The emit is only honest if the message really went out.
        expect(peerRequestTags(peer)).toContain('ListRingVrfKeysRequest');
      } finally {
        unsubscribe();
      }
    });
  });

  describe('peer actions', () => {
    const disconnected = () => enumValue('Disconnected', undefined);
    const signResponse = () =>
      enumValue('SignResponse', {
        respondingTo: 'whatever',
        payload: { success: true as const, value: { signature: bytes(9), signedTransaction: undefined } },
      });

    it('auto-ACKs a decoded incoming request with success', async () => {
      const { session, peer } = buildSession();
      session.subscribe(vi.fn(() => okAsync(true)));

      await expect(peer.request('peer-msg-ack', disconnected())).toBeOk();
      peer.dispose();
    });

    it('auto-ACKs a peer reply (e.g. SignResponse) with success even though the subscribe callback ignores it', async () => {
      // Mirrors impl.ts: the consumer callback acts only on Disconnected and returns false
      // (a no-op) for every reply. That false must NOT gate the transport ACK.
      const { session, peer } = buildSession();
      session.subscribe(vi.fn(() => okAsync(false)));

      await expect(peer.request('reply-1', signResponse())).toBeOk();
      peer.dispose();
    });

    it('auto-ACKs an undecodable incoming request with decodingFailed', async () => {
      const { session, peer } = buildSession();
      session.subscribe(vi.fn(() => okAsync(true)));

      // Bytes that decrypt but do not decode as a RemoteMessage: the wrapper
      // must NACK rather than leave the peer waiting.
      await expect(peer.sendUndecodable()).toBeErrWith(new DecodingError());
      peer.dispose();
    });

    it('re-ACKs an already-processed request with success without re-running the callback', async () => {
      const storage = createMemoryAdapter();
      await storage.write(PROCESSED_KEY, JSON.stringify(['peer-msg-dup']));

      const { session, peer } = buildSession({ storage });
      const { events, unsubscribe } = captureEvents();
      try {
        const callback = vi.fn(() => okAsync(true));
        session.subscribe(callback);

        // The peer retransmitted because it never saw our ACK: we MUST ACK again,
        // but the side effects (callback, debug emits) must not re-run.
        await expect(peer.request('peer-msg-dup', disconnected())).toBeOk();
        // Side effects run independently of the ACK, so give them a tick.
        await flush();

        expect(callback).not.toHaveBeenCalled();
        expect(events.filter(e => e.layer === 'session')).toHaveLength(0);
      } finally {
        unsubscribe();
        peer.dispose();
      }
    });

    it('emits peer_action_received and peer_action_processed when the callback returns true', async () => {
      const { session, peer } = buildSession();
      const { events, unsubscribe } = captureEvents();
      try {
        const callback = vi.fn(() => okAsync(true));
        session.subscribe(callback);
        await peer.send('peer-msg-1', disconnected());
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
        peer.dispose();
      }
    });

    it('emits peer_action_failed when the callback errors', async () => {
      // silence the console.error from the production code's orTee
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(vi.fn());

      const { session, peer } = buildSession();
      const { events, unsubscribe } = captureEvents();
      try {
        const callback = vi.fn(() => errAsync(new Error('handler boom')) as unknown as ResultAsync<boolean, Error>);
        session.subscribe(callback);
        await peer.send('peer-msg-2', disconnected());
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
        peer.dispose();
      }
    });

    it('does not emit anything for messages that were already processed in a previous run', async () => {
      const storage = createMemoryAdapter();
      await storage.write(PROCESSED_KEY, JSON.stringify(['peer-msg-3']));

      const { session, peer } = buildSession({ storage });
      const { events, unsubscribe } = captureEvents();
      try {
        const callback = vi.fn(() => okAsync(true));
        session.subscribe(callback);
        // The ACK proves the host received and handled it; `send` alone only
        // proves the message was queued.
        await expect(peer.request('peer-msg-3', disconnected())).toBeOk();
        await flush();

        expect(events.filter(e => e.layer === 'session')).toHaveLength(0);
        expect(callback).not.toHaveBeenCalled();
      } finally {
        unsubscribe();
        peer.dispose();
      }
    });
  });
});

describe('createUserSession request/reply ordering', () => {
  // The transport ACK and the peer's application reply are independent channels
  // with non-deterministic arrival order. The reply must not be gated on the
  // ACK, otherwise a lost or late ACK wedges the call for the full queue timeout
  // even though the answer already arrived.
  it('resolves from the peer reply without waiting for the request ACK', async () => {
    const { session, peer } = buildSession();
    peer.answerWith(successReply); // replies, but never ACKs

    await expect(session.signPayload(signPayloadRequest)).toBeOk();
    peer.dispose();
  }, 2000);

  it('fails fast when the request ACK errors even if no reply ever arrives', async () => {
    const { session, peer } = buildSession();
    peer.ackWith('decodingFailed'); // NACKs, and never replies

    await expect(session.signPayload(signPayloadRequest)).toBeErr();
    peer.dispose();
  }, 2000);
});

describe('createUserSession abortPendingRequests', () => {
  // A store that starts working and can be switched to rejecting every submit.
  function switchableStore() {
    const store = createInMemoryStatementStore();
    let broken = false;

    return {
      break: () => (broken = true),
      adapter: {
        ...store,
        submitStatement: (statement: Parameters<StatementStoreAdapter['submitStatement']>[0]) =>
          broken ? errAsync(new Error('submit rejected')) : store.submitStatement(statement),
      } as StatementStoreAdapter,
    };
  }

  it('supersedes the outgoing batch with an empty one', async () => {
    const statementStore = createInMemoryStatementStore();
    const { session, peer, userSession } = buildSession({ statementStore });
    const sharedSecret = userSession.remoteAccount.publicKey;
    void session.signPayload(signPayloadRequest); // puts a batch on the wire
    await flush();
    expect(requestBatchSizes(statementStore, sharedSecret)).toStrictEqual([1]);

    await expect(session.abortPendingRequests()).toBeOk();

    // A resubmission of the same body would also grow the statement count, so
    // assert the superseding batch actually carries nothing.
    expect(requestBatchSizes(statementStore, sharedSecret)).toStrictEqual([1, 0]);
    peer.dispose();
  });

  it('propagates a failure to submit the superseding statement', async () => {
    const store = switchableStore();
    const { session, peer } = buildSession({ statementStore: store.adapter });
    void session.signPayload(signPayloadRequest);
    await flush();
    store.break();

    await expect(session.abortPendingRequests()).toBeErr();
    peer.dispose();
  });

  it('rejects the in-flight and queued signing requests, freeing the queue', async () => {
    // The peer stays silent, so both requests are still pending at abort time.
    const { session, peer } = buildSession();
    const inFlight = session.signPayload(signPayloadRequest); // takes the single slot
    const queued = session.signRaw(signRawRequest); // waits behind it

    await session.abortPendingRequests();

    const [inFlightResult, queuedResult] = await Promise.all([inFlight, queued]);
    await expect(inFlightResult).toBeErr();
    await expect(queuedResult).toBeErr();
    peer.dispose();
  });

  it('lets a fresh request through after an abort', async () => {
    const { session, peer } = buildSession();
    const aborted = session.signPayload(signPayloadRequest);
    await session.abortPendingRequests();
    await expect(aborted).toBeErr();

    peer.answerWith(successReply);
    peer.ackWith('success');
    await expect(session.signPayload(signPayloadRequest)).toBeOk();
    peer.dispose();
  });
});
