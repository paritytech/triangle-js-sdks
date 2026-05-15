import { createMemoryAdapter } from '@novasamatech/storage-adapter';
import { errAsync, okAsync } from 'neverthrow';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createAllowanceService } from '../src/sso/allowance/impl.js';
import { createAllowanceRepository } from '../src/sso/allowance/repository.js';
import type { UserSession } from '../src/sso/sessionManager/userSession.js';

// A non-zero 32-byte secret so deriveSr25519PublicKey produces a valid key.
const FAKE_SECRET = new Uint8Array(64).fill(7);
const ANOTHER_SECRET = new Uint8Array(64).fill(11);

function makeSession(overrides?: Partial<UserSession>): UserSession {
  const requestResourceAllocation = vi.fn();
  return {
    id: 'session-1',
    localAccount: {} as never,
    remoteAccount: {} as never,
    rootAccountId: new Uint8Array(32) as never,
    sendDisconnectMessage: vi.fn(),
    signPayload: vi.fn(),
    signRaw: vi.fn(),
    getRingVrfAlias: vi.fn(),
    requestResourceAllocation: requestResourceAllocation as never,
    subscribe: vi.fn(() => () => undefined),
    dispose: vi.fn(),
    ...overrides,
  } as UserSession;
}

function makeSessions(session: UserSession) {
  return {
    read: () => [session],
    subscribe: () => () => undefined,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('createAllowanceService', () => {
  describe('getBulletinSigner', () => {
    it('requests from mobile on cache miss and persists the slot account key', async () => {
      const session = makeSession();
      const repository = createAllowanceRepository('salt', createMemoryAdapter());
      vi.mocked(session.requestResourceAllocation).mockReturnValue(
        okAsync([
          {
            tag: 'Allocated',
            value: { tag: 'BulletInAllowance', value: { slotAccountKey: FAKE_SECRET } },
          },
        ]),
      );
      const service = createAllowanceService({ sessions: makeSessions(session), repository });

      const result = await service.getBulletinSigner('session-1', 'product.dot');

      expect(result.isOk()).toBe(true);
      expect(session.requestResourceAllocation).toHaveBeenCalledWith({
        callingProductId: 'product.dot',
        resources: [{ tag: 'BulletInAllowance', value: undefined }],
        onExisting: 'Ignore',
      });

      const cached = await repository.read('session-1', 'product.dot', 'bulletin');
      expect(cached._unsafeUnwrap()).toEqual(FAKE_SECRET);
    });

    it('uses cached key on cache hit without calling the session', async () => {
      const session = makeSession();
      const repository = createAllowanceRepository('salt', createMemoryAdapter());
      await repository.write('session-1', 'product.dot', 'bulletin', FAKE_SECRET);
      const service = createAllowanceService({ sessions: makeSessions(session), repository });

      const result = await service.getBulletinSigner('session-1', 'product.dot');

      expect(result.isOk()).toBe(true);
      expect(session.requestResourceAllocation).not.toHaveBeenCalled();
    });

    it('returns Rejected error when mobile rejects', async () => {
      const session = makeSession();
      const repository = createAllowanceRepository('salt', createMemoryAdapter());
      vi.mocked(session.requestResourceAllocation).mockReturnValue(okAsync([{ tag: 'Rejected', value: undefined }]));
      const service = createAllowanceService({ sessions: makeSessions(session), repository });

      const result = await service.getBulletinSigner('session-1', 'product.dot');

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().reason).toBe('Rejected');
    });

    it('returns NotAvailable error when mobile reports unavailable', async () => {
      const session = makeSession();
      const repository = createAllowanceRepository('salt', createMemoryAdapter());
      vi.mocked(session.requestResourceAllocation).mockReturnValue(
        okAsync([{ tag: 'NotAvailable', value: undefined }]),
      );
      const service = createAllowanceService({ sessions: makeSessions(session), repository });

      const result = await service.getBulletinSigner('session-1', 'product.dot');

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().reason).toBe('NotAvailable');
    });

    it('returns NoSession when sessionId does not match an active session', async () => {
      const session = makeSession();
      const repository = createAllowanceRepository('salt', createMemoryAdapter());
      const service = createAllowanceService({ sessions: makeSessions(session), repository });

      const result = await service.getBulletinSigner('unknown-session', 'product.dot');

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().reason).toBe('NoSession');
    });

    it('returns UnexpectedResponse when mobile returns the wrong resource tag', async () => {
      const session = makeSession();
      const repository = createAllowanceRepository('salt', createMemoryAdapter());
      vi.mocked(session.requestResourceAllocation).mockReturnValue(
        okAsync([
          {
            tag: 'Allocated',
            value: { tag: 'StatementStoreAllowance', value: { slotAccountKey: FAKE_SECRET } },
          },
        ]),
      );
      const service = createAllowanceService({ sessions: makeSessions(session), repository });

      const result = await service.getBulletinSigner('session-1', 'product.dot');

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().reason).toBe('UnexpectedResponse');
    });

    it('propagates session.requestResourceAllocation errors', async () => {
      const session = makeSession();
      const repository = createAllowanceRepository('salt', createMemoryAdapter());
      vi.mocked(session.requestResourceAllocation).mockReturnValue(errAsync(new Error('transport down')));
      const service = createAllowanceService({ sessions: makeSessions(session), repository });

      const result = await service.getBulletinSigner('session-1', 'product.dot');

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().reason).toBe('UnexpectedResponse');
    });
  });

  describe('getStatementStoreProver', () => {
    it('requests StatementStoreAllowance and caches under the statementStore key', async () => {
      const session = makeSession();
      const repository = createAllowanceRepository('salt', createMemoryAdapter());
      vi.mocked(session.requestResourceAllocation).mockReturnValue(
        okAsync([
          {
            tag: 'Allocated',
            value: { tag: 'StatementStoreAllowance', value: { slotAccountKey: ANOTHER_SECRET } },
          },
        ]),
      );
      const service = createAllowanceService({ sessions: makeSessions(session), repository });

      const result = await service.getStatementStoreProver('session-1', 'product.dot');

      expect(result.isOk()).toBe(true);
      expect(session.requestResourceAllocation).toHaveBeenCalledWith({
        callingProductId: 'product.dot',
        resources: [{ tag: 'StatementStoreAllowance', value: undefined }],
        onExisting: 'Ignore',
      });

      const cached = await repository.read('session-1', 'product.dot', 'statementStore');
      expect(cached._unsafeUnwrap()).toEqual(ANOTHER_SECRET);

      // bulletin slot must remain empty
      const bulletinCached = await repository.read('session-1', 'product.dot', 'bulletin');
      expect(bulletinCached._unsafeUnwrap()).toBeNull();
    });
  });
});
