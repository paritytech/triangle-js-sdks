import { enumValue } from '@novasamatech/scale';
import type { StatementStoreAdapter } from '@novasamatech/statement-store';
import { createInMemoryStatementStore } from '@novasamatech/statement-store';
import { createMemoryAdapter } from '@novasamatech/storage-adapter';
import { describe, expect, it } from 'vitest';

import { onHostPappDebugMessage } from '../src/debugBus.js';
import type { HostPappDebugEvent } from '../src/debugTypes.js';
import { createIdentityRepository } from '../src/identity/impl.js';
import { createAllowanceRepository } from '../src/sso/allowance/repository.js';
import { createSsoSessionManager } from '../src/sso/sessionManager/impl.js';
import { processedMessagesKey } from '../src/sso/sessionManager/userSession.js';
import { createUserSecretRepository } from '../src/sso/userSecretRepository.js';
import type { StoredUserSession } from '../src/sso/userSessionRepository.js';
import { createUserSessionRepository } from '../src/sso/userSessionRepository.js';

import {
  createPeerSession,
  createUnwritableStatementStore,
  flush,
  inertIdentityAdapter,
  makeSecrets,
  makeStoredUserSession,
} from './peerSession.js';

// Everything is real except the identity chain adapter, which these lifecycle
// tests never reach.
function buildHarness(statementStore: StatementStoreAdapter = createInMemoryStatementStore()) {
  const storage = createMemoryAdapter();

  const ssoSessionRepository = createUserSessionRepository(storage);
  const userSecretRepository = createUserSecretRepository('session-manager-test', storage);
  const allowanceRepository = createAllowanceRepository('session-manager-test', storage);
  const identityRepository = createIdentityRepository({ adapter: inertIdentityAdapter, storage });

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

    await peer.send('peer-disconnect', enumValue('Disconnected', undefined));
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
