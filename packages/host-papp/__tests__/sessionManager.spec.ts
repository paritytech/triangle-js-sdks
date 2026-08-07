import { enumValue } from '@novasamatech/scale';
import type { StatementStoreAdapter } from '@novasamatech/statement-store';
import {
  createAccountId,
  createEncryption,
  createInMemoryStatementStore,
  createSession,
  createSr25519Prover,
  createSr25519Secret,
} from '@novasamatech/statement-store';
import { createMemoryAdapter } from '@novasamatech/storage-adapter';
import { errAsync, okAsync } from 'neverthrow';
import { EMPTY } from 'rxjs';
import { describe, expect, it } from 'vitest';

import type { EncrSecret, SsSecret } from '../src/crypto.js';
import { onHostPappDebugMessage } from '../src/debugBus.js';
import type { HostPappDebugEvent } from '../src/debugTypes.js';
import { createIdentityRepository } from '../src/identity/impl.js';
import type { IdentityAdapter } from '../src/identity/types.js';
import { createAllowanceRepository } from '../src/sso/allowance/repository.js';
import { createSsoSessionManager } from '../src/sso/sessionManager/impl.js';
import { RemoteMessageCodec } from '../src/sso/sessionManager/scale/remoteMessage.js';
import { processedMessagesKey } from '../src/sso/sessionManager/userSession.js';
import { createUserSecretRepository } from '../src/sso/userSecretRepository.js';
import type { StoredUserSession } from '../src/sso/userSessionRepository.js';
import { createUserSessionRepository } from '../src/sso/userSessionRepository.js';

const flush = () => new Promise(resolve => setImmediate(resolve));

// Everything is real except the identity chain adapter, which these lifecycle
// tests never reach.
function buildHarness(statementStore: StatementStoreAdapter = createInMemoryStatementStore()) {
  const storage = createMemoryAdapter();

  const ssoSessionRepository = createUserSessionRepository(storage);
  const userSecretRepository = createUserSecretRepository('session-manager-test', storage);
  const allowanceRepository = createAllowanceRepository('session-manager-test', storage);
  const identityAdapter: IdentityAdapter = {
    readIdentities: () => okAsync({}),
    watchIdentity: () => EMPTY,
  };
  const identityRepository = createIdentityRepository({ adapter: identityAdapter, storage });

  const manager = createSsoSessionManager({
    ssoSessionRepository,
    userSecretRepository,
    allowanceRepository,
    identityRepository,
    statementStore,
    storage,
  });

  return {
    manager,
    storage,
    statementStore,
    ssoSessionRepository,
    userSecretRepository,
    allowanceRepository,
    // The write notifies the manager's subscription, as the auth flow does.
    setSessions(sessions: StoredUserSession[]) {
      return ssoSessionRepository.mutate(() => sessions);
    },
  };
}

type SessionHarness = ReturnType<typeof buildHarness>;

function makeStoredUserSession(id: string): StoredUserSession {
  // Key material from the id, so distinct sessions derive distinct channels.
  const seed = id.charCodeAt(id.length - 1);
  const bytes = (length: number) => new Uint8Array(length).fill(seed);
  return {
    id,
    localAccount: { accountId: createAccountId(bytes(32)), pin: undefined },
    // Must differ from the local id: the two derive the outgoing and incoming
    // topics, and equal ids collapse them into one channel.
    remoteAccount: {
      accountId: createAccountId(new Uint8Array(32).fill(seed + 1)),
      publicKey: bytes(32),
      pin: undefined,
    },
    rootAccountId: createAccountId(bytes(32)),
    identityAccountId: createAccountId(bytes(32)),
    identityChatPublicKey: bytes(32),
    ssoEncPubKey: bytes(32),
    rootEntropySource: bytes(32),
    deviceEncPubKey: bytes(32),
  };
}

// `ssSecret` must be a real expanded sr25519 secret — random 32 bytes trap in
// the schnorrkel wasm.
function makeSecrets(seed: Uint8Array) {
  return {
    ssSecret: createSr25519Secret(seed) as SsSecret,
    encrSecret: seed as EncrSecret,
    identityChatPrivateKey: seed,
  };
}

// Every per-session blob the SDK persists, so a teardown that misses one shows
// up as a leftover key.
async function seedSessionStorage(harness: SessionHarness, session: StoredUserSession) {
  const bytes = new Uint8Array(32).fill(7);
  // Secrets before the session row, as the auth flow writes them: the prover
  // reads them once, at session construction.
  await harness.userSecretRepository.write(session.id, makeSecrets(bytes));
  await harness.setSessions([session]);
  await harness.allowanceRepository.write(session.id, 'product-x', 'bulletin', bytes);
  await harness.storage.write(processedMessagesKey(session.id), JSON.stringify(['message-1']));
}

async function readSessionStorage(harness: SessionHarness, sessionId: string) {
  return {
    sessions: await harness.ssoSessionRepository.read().unwrapOr([]),
    secrets: await harness.userSecretRepository.read(sessionId).unwrapOr(null),
    allowance: await harness.allowanceRepository.read(sessionId, 'product-x', 'bulletin').unwrapOr(null),
    processed: await harness.storage.read(processedMessagesKey(sessionId)).unwrapOr(null),
  };
}

const PURGED = { sessions: [], secrets: null, allowance: null, processed: null };

// The peer half of `session`: local and remote swapped over the same store, so
// a submit lands on the topic the host listens on.
function createPeerSession(statementStore: StatementStoreAdapter, session: StoredUserSession) {
  const peer = createSession({
    localAccount: { accountId: session.remoteAccount.accountId, pin: session.remoteAccount.pin },
    remoteAccount: { ...session.localAccount, publicKey: session.remoteAccount.publicKey },
    statementStore,
    encryption: createEncryption(session.remoteAccount.publicKey),
    // Statements carry their signer in the proof, so any secret proves them.
    prover: createSr25519Prover(createSr25519Secret(new Uint8Array(32).fill(11))),
    sessionKey: session.remoteAccount.publicKey,
  });

  return {
    // Not `request`: the host tears the session down on Disconnected, so
    // waiting for its ACK would wait forever.
    sendDisconnected: (messageId: string) =>
      peer.submitRequestMessage(RemoteMessageCodec, {
        messageId,
        data: enumValue('v1', enumValue('Disconnected', undefined)),
      }),
    dispose: () => peer.dispose(),
  };
}

// Offline / no allowance / unreachable peer.
function createUnwritableStatementStore(): StatementStoreAdapter {
  return {
    queryStatements: () => okAsync([]),
    subscribeStatements: () => () => undefined,
    submitStatement: () => errAsync(new Error('submit rejected')),
  };
}

function captureEvents() {
  const events: HostPappDebugEvent[] = [];
  const unsubscribe = onHostPappDebugMessage(event => events.push(event));
  return { events, unsubscribe };
}

describe('createSsoSessionManager teardown', () => {
  // Notifying the peer used to gate the teardown: a failed submit left the host
  // signed in with the user's secrets on disk.
  it.each([
    ['a reachable peer', createInMemoryStatementStore],
    ['an undeliverable Disconnected message', createUnwritableStatementStore],
  ])('drops every persisted blob of a session on disconnect with %s', async (_label, makeStore) => {
    const harness = buildHarness(makeStore());
    const session = makeStoredUserSession('session-D');
    await seedSessionStorage(harness, session);

    const result = await harness.manager.disconnect(session);

    expect(result.isOk()).toBe(true);
    expect(await readSessionStorage(harness, session.id)).toStrictEqual(PURGED);
  });

  it('forgets a session without contacting the peer', async () => {
    const harness = buildHarness();
    const session = makeStoredUserSession('session-H');
    await seedSessionStorage(harness, session);

    const result = await harness.manager.forget(session.id);

    expect(result.isOk()).toBe(true);
    expect(await readSessionStorage(harness, session.id)).toStrictEqual(PURGED);
  });

  it('leaves other sessions untouched', async () => {
    const harness = buildHarness();
    const kept = makeStoredUserSession('session-F');
    const dropped = makeStoredUserSession('session-G');
    await harness.userSecretRepository.write(dropped.id, makeSecrets(new Uint8Array(32).fill(7)));
    await harness.userSecretRepository.write(kept.id, makeSecrets(new Uint8Array(32).fill(9)));
    await harness.setSessions([dropped, kept]);

    await harness.manager.disconnect(dropped);

    const remaining = await readSessionStorage(harness, kept.id);
    expect(remaining.sessions.map(s => s.id)).toStrictEqual([kept.id]);
    expect(remaining.secrets).not.toBeNull();
  });

  it('drops every persisted blob when the peer initiates the disconnect', async () => {
    const harness = buildHarness();
    const session = makeStoredUserSession('session-I');
    await seedSessionStorage(harness, session);
    const peer = createPeerSession(harness.statementStore, session);

    await peer.sendDisconnected('peer-disconnect');
    await flush();

    expect(await readSessionStorage(harness, session.id)).toStrictEqual(PURGED);
    peer.dispose();
  });
});

// Regression coverage: session.opened and session.terminated should fire when
// the repository subscription adds and removes sessions. If a future refactor
// drops either emit, the matching assertion below fails.
describe('createSsoSessionManager debug emits', () => {
  it('emits session.opened with flowId === sessionId when a new session appears in the repository', async () => {
    const harness = buildHarness();
    const { events, unsubscribe } = captureEvents();
    try {
      await harness.setSessions([makeStoredUserSession('session-A')]);

      const opened = events.find(e => e.layer === 'session' && e.event === 'opened');
      expect(opened).toMatchObject({
        flowId: 'session-A',
        payload: { sessionId: 'session-A' },
      });
    } finally {
      unsubscribe();
    }
  });

  it('emits session.terminated with flowId === sessionId when a session leaves the repository', async () => {
    const harness = buildHarness();
    const { events, unsubscribe } = captureEvents();
    try {
      await harness.setSessions([makeStoredUserSession('session-B')]);
      await harness.setSessions([]);

      const terminated = events.find(e => e.layer === 'session' && e.event === 'terminated');
      expect(terminated).toMatchObject({
        flowId: 'session-B',
        payload: { sessionId: 'session-B' },
      });
    } finally {
      unsubscribe();
    }
  });

  it('does not re-emit session.opened for a session that is already active', async () => {
    const harness = buildHarness();
    const { events, unsubscribe } = captureEvents();
    try {
      const session = makeStoredUserSession('session-C');
      await harness.setSessions([session]);
      await harness.setSessions([session]);

      const opens = events.filter(e => e.layer === 'session' && e.event === 'opened' && e.flowId === 'session-C');
      expect(opens).toHaveLength(1);
    } finally {
      unsubscribe();
    }
  });

  it('emits opened/terminated for each session in a multi-session transition', async () => {
    const harness = buildHarness();
    const { events, unsubscribe } = captureEvents();
    try {
      await harness.setSessions([makeStoredUserSession('session-A'), makeStoredUserSession('session-B')]);
      await harness.setSessions([makeStoredUserSession('session-B')]);

      const openedIds = events.filter(e => e.layer === 'session' && e.event === 'opened').map(e => e.flowId);
      const terminatedIds = events.filter(e => e.layer === 'session' && e.event === 'terminated').map(e => e.flowId);

      expect(openedIds).toContain('session-A');
      expect(openedIds).toContain('session-B');
      expect(terminatedIds).toEqual(['session-A']);
    } finally {
      unsubscribe();
    }
  });
});
