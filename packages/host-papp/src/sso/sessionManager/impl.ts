import type { StatementStoreAdapter } from '@novasamatech/statement-store';
import { createEncryption } from '@novasamatech/statement-store';
import type { StorageAdapter } from '@novasamatech/storage-adapter';
import { okAsync } from 'neverthrow';

import { emitHostPappDebugMessage } from '../../debugBus.js';
import { createState } from '../../helpers/state.js';
import type { Callback } from '../../types.js';
import type { AllowanceRepository } from '../allowance/index.js';
import { createSsoStatementProver } from '../ssoSessionProver.js';
import type { UserSecretRepository } from '../userSecretRepository.js';
import type { StoredUserSession, UserSessionRepository } from '../userSessionRepository.js';

import type { UserSession } from './userSession.js';
import { createUserSession } from './userSession.js';

export type SsoSessionManager = ReturnType<typeof createSsoSessionManager>;

type Params = {
  storage: StorageAdapter;
  statementStore: StatementStoreAdapter;
  ssoSessionRepository: UserSessionRepository;
  userSecretRepository: UserSecretRepository;
  allowanceRepository: AllowanceRepository;
};

export function createSsoSessionManager({
  ssoSessionRepository,
  userSecretRepository,
  allowanceRepository,
  statementStore,
  storage,
}: Params) {
  const localSessions = createState<Record<string, UserSession>>({});
  const sessionUnsubscribes = new Map<string, VoidFunction>();

  const releaseSession = (id: string) => {
    sessionUnsubscribes.get(id)?.();
    sessionUnsubscribes.delete(id);
  };

  const disconnect = (session: StoredUserSession) => {
    return ssoSessionRepository.filter(s => s.id !== session.id).map(() => undefined);
  };

  ssoSessionRepository.subscribe(userSessions => {
    const activeSessions = localSessions.read();
    const toRemove = new Set(Object.keys(activeSessions));
    const toAdd = new Set<UserSession>();

    for (const userSession of userSessions) {
      toRemove.delete(userSession.id);

      if (userSession.id in activeSessions) continue;

      const session = createSession(userSession, statementStore, storage, userSecretRepository);

      toAdd.add(session);

      emitHostPappDebugMessage({
        layer: 'session',
        event: 'opened',
        flowId: userSession.id,
        timestamp: Date.now(),
        payload: { sessionId: userSession.id },
      });

      const unsubscribe = session.subscribe(message => {
        switch (message.data.tag) {
          case 'v1': {
            switch (message.data.value.tag) {
              case 'Disconnected':
                return disconnect(userSession).map(() => true);
            }
          }
        }

        return okAsync(false);
      });

      sessionUnsubscribes.set(session.id, unsubscribe);
    }

    if (toRemove.size > 0) {
      for (const id of toRemove) {
        emitHostPappDebugMessage({
          layer: 'session',
          event: 'terminated',
          flowId: id,
          timestamp: Date.now(),
          payload: { sessionId: id },
        });
        releaseSession(id);
        activeSessions[id]?.dispose();
      }
      localSessions.write(prev => {
        return Object.fromEntries(Object.entries(prev).filter(([id]) => !toRemove.has(id)));
      });
    }

    if (toAdd.size > 0) {
      localSessions.write(prev => ({
        ...prev,
        ...Object.fromEntries(Array.from(toAdd).map(s => [s.id, s])),
      }));
    }
  });

  return {
    sessions: {
      read: () => Object.values(localSessions.read()),
      subscribe: (callback: Callback<UserSession[]>) =>
        localSessions.subscribe(sessions => callback(Object.values(sessions))),
    },

    disconnect(userSession: StoredUserSession) {
      const session = createSession(userSession, statementStore, storage, userSecretRepository);

      return session
        .sendDisconnectMessage()
        .andThen(() => disconnect(userSession))
        .andThen(() => userSecretRepository.clear(userSession.id))
        .andThen(() => allowanceRepository.clearSession(userSession.id));
    },

    dispose() {
      for (const session of Object.values(localSessions.read())) {
        releaseSession(session.id);
        session.dispose();
      }
    },
  };
}

function createSession(
  userSession: StoredUserSession,
  statementStore: StatementStoreAdapter,
  storage: StorageAdapter,
  userSecretRepository: UserSecretRepository,
) {
  const encryption = createEncryption(userSession.remoteAccount.publicKey);
  const prover = createSsoStatementProver(userSession, userSecretRepository);
  return createUserSession({
    userSession,
    statementStore,
    encryption,
    storage,
    prover,
  });
}
