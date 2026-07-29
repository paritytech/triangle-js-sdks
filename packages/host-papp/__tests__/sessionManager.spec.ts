import { createAccountId, createInMemoryStatementStore } from '@novasamatech/statement-store';
import { createMemoryAdapter } from '@novasamatech/storage-adapter';
import { okAsync } from 'neverthrow';
import { EMPTY } from 'rxjs';
import { describe, expect, it } from 'vitest';

import { onHostPappDebugMessage } from '../src/debugBus.js';
import type { HostPappDebugEvent } from '../src/debugTypes.js';
import { createIdentityRepository } from '../src/identity/impl.js';
import type { IdentityAdapter } from '../src/identity/types.js';
import { createAllowanceRepository } from '../src/sso/allowance/repository.js';
import { createSsoSessionManager } from '../src/sso/sessionManager/impl.js';
import { createUserSecretRepository } from '../src/sso/userSecretRepository.js';
import type { StoredUserSession } from '../src/sso/userSessionRepository.js';
import { createUserSessionRepository } from '../src/sso/userSessionRepository.js';

// Everything the manager touches is real: repositories over an in-memory
// storage adapter, and real UserSessions over an in-memory statement store.
// The only external boundary stubbed is the identity chain adapter (never
// reached here — no signing/identity lookups happen in these lifecycle tests).
function buildHarness() {
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
    statementStore: createInMemoryStatementStore(),
    storage,
  });

  return {
    manager,
    // Set the persisted session list to exactly `sessions`; the write notifies
    // the manager's subscription, mirroring how the auth flow drives it.
    setSessions(sessions: StoredUserSession[]) {
      return ssoSessionRepository.mutate(() => sessions);
    },
  };
}

function makeStoredUserSession(id: string): StoredUserSession {
  // Seed the key material from the id so distinct sessions derive distinct
  // SessionIds / channels in the real statement-store session.
  const seed = id.charCodeAt(id.length - 1);
  const bytes = (length: number) => new Uint8Array(length).fill(seed);
  return {
    id,
    localAccount: { accountId: createAccountId(bytes(32)), pin: undefined },
    remoteAccount: { accountId: createAccountId(bytes(32)), publicKey: bytes(32), pin: undefined },
    rootAccountId: createAccountId(bytes(32)),
    identityAccountId: createAccountId(bytes(32)),
    identityChatPublicKey: bytes(32),
    ssoEncPubKey: bytes(32),
    rootEntropySource: bytes(32),
    deviceEncPubKey: bytes(32),
  };
}

function captureEvents() {
  const events: HostPappDebugEvent[] = [];
  const unsubscribe = onHostPappDebugMessage(event => events.push(event));
  return { events, unsubscribe };
}

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
