import type { StatementStoreAdapter } from '@novasamatech/statement-store';
import type { StorageAdapter } from '@novasamatech/storage-adapter';
import { createMemoryAdapter } from '@novasamatech/storage-adapter';
import { okAsync } from 'neverthrow';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createUserSession: vi.fn(),
}));

vi.mock('../src/sso/sessionManager/userSession.js', () => ({
  createUserSession: mocks.createUserSession,
}));

vi.mock('@novasamatech/statement-store', async importOriginal => {
  const actual = await importOriginal<typeof import('@novasamatech/statement-store')>();
  return {
    ...actual,
    createEncryption: vi.fn(() => ({ decrypt: vi.fn(), encrypt: vi.fn() })),
  };
});

vi.mock('../src/sso/ssoSessionProver.js', () => ({
  createSsoStatementProver: vi.fn(() => ({})),
}));

import { onHostPappDebugMessage } from '../src/debugBus.js';
import type { HostPappDebugEvent } from '../src/debugTypes.js';
import { createAllowanceRepository } from '../src/sso/allowance/repository.js';
import { createSsoSessionManager } from '../src/sso/sessionManager/impl.js';
import type { StoredUserSession, UserSessionRepository } from '../src/sso/userSessionRepository.js';

type RepoCallback = (sessions: StoredUserSession[]) => void;

function buildHarness() {
  let deliver: RepoCallback | null = null;

  const repoSubscribe = vi.fn((cb: RepoCallback) => {
    deliver = cb;
    return () => {
      deliver = null;
    };
  });

  const ssoSessionRepository = {
    subscribe: repoSubscribe,
    filter: vi.fn(() => okAsync(undefined)),
    add: vi.fn(() => okAsync(undefined)),
  } as unknown as UserSessionRepository;

  const userSecretRepository = {
    clear: vi.fn(() => okAsync(undefined)),
  } as any;
  const statementStore = {} as StatementStoreAdapter;
  const storage = {} as StorageAdapter;
  const allowanceRepository = createAllowanceRepository('session-manager-test', createMemoryAdapter());

  const manager = createSsoSessionManager({
    ssoSessionRepository,
    userSecretRepository,
    allowanceRepository,
    statementStore,
    storage,
  });

  return {
    manager,
    repoSubscribe,
    push(sessions: StoredUserSession[]) {
      if (!deliver) throw new Error('ssoSessionRepository.subscribe was not called');
      deliver(sessions);
    },
  };
}

function makeStoredUserSession(id: string): StoredUserSession {
  return {
    id,
    localAccount: { accountId: new Uint8Array(32), kind: 'local' } as any,
    remoteAccount: { accountId: new Uint8Array(32), publicKey: new Uint8Array(32), kind: 'remote' } as any,
    rootAccountId: new Uint8Array(32) as any,
  } as StoredUserSession;
}

function captureEvents() {
  const events: HostPappDebugEvent[] = [];
  const unsubscribe = onHostPappDebugMessage(event => events.push(event));
  return { events, unsubscribe };
}

beforeEach(() => {
  mocks.createUserSession.mockReset().mockImplementation((args: { userSession: StoredUserSession }) => ({
    id: args.userSession.id,
    localAccount: args.userSession.localAccount,
    remoteAccount: args.userSession.remoteAccount,
    rootAccountId: args.userSession.rootAccountId,
    subscribe: vi.fn(() => vi.fn()),
    dispose: vi.fn(),
    sendDisconnectMessage: vi.fn(() => okAsync(undefined)),
    signPayload: vi.fn(),
    signRaw: vi.fn(),
    createTransaction: vi.fn(),
    getRingVrfAlias: vi.fn(),
    requestResourceAllocation: vi.fn(),
  }));
});

// Regression coverage: session.opened and session.terminated should fire when
// the repository subscription adds and removes sessions. If a future refactor
// drops either emit, the matching assertion below fails.
describe('createSsoSessionManager debug emits', () => {
  it('emits session.opened with flowId === sessionId when a new session appears in the repository', () => {
    const harness = buildHarness();
    const { events, unsubscribe } = captureEvents();
    try {
      const session = makeStoredUserSession('session-A');
      harness.push([session]);

      const opened = events.find(e => e.layer === 'session' && e.event === 'opened');
      expect(opened).toMatchObject({
        flowId: 'session-A',
        payload: { sessionId: 'session-A' },
      });
    } finally {
      unsubscribe();
    }
  });

  it('emits session.terminated with flowId === sessionId when a session leaves the repository', () => {
    const harness = buildHarness();
    const { events, unsubscribe } = captureEvents();
    try {
      const session = makeStoredUserSession('session-B');
      harness.push([session]);
      harness.push([]);

      const terminated = events.find(e => e.layer === 'session' && e.event === 'terminated');
      expect(terminated).toMatchObject({
        flowId: 'session-B',
        payload: { sessionId: 'session-B' },
      });
    } finally {
      unsubscribe();
    }
  });

  it('does not re-emit session.opened for a session that is already active', () => {
    const harness = buildHarness();
    const { events, unsubscribe } = captureEvents();
    try {
      const session = makeStoredUserSession('session-C');
      harness.push([session]);
      harness.push([session]);

      const opens = events.filter(e => e.layer === 'session' && e.event === 'opened' && e.flowId === 'session-C');
      expect(opens).toHaveLength(1);
    } finally {
      unsubscribe();
    }
  });

  it('emits opened/terminated for each session in a multi-session transition', () => {
    const harness = buildHarness();
    const { events, unsubscribe } = captureEvents();
    try {
      const a = makeStoredUserSession('session-A');
      const b = makeStoredUserSession('session-B');
      harness.push([a, b]);
      harness.push([b]);

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
