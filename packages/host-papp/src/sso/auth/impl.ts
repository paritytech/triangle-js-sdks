import type { StatementStoreAdapter } from '@novasamatech/statement-store';
import { createAccountId, createLocalSessionAccount, createRemoteSessionAccount } from '@novasamatech/statement-store';
import { ResultAsync, errAsync, okAsync } from 'neverthrow';

import type { EncrSecret, SsSecret } from '../../crypto.js';
import { createFlowId, emitHostPappDebugMessage } from '../../debugBus.js';
import { AbortError } from '../../helpers/abortError.js';
import { createState, readonly } from '../../helpers/state.js';
import { toError } from '../../helpers/utils.js';
import type { DeviceIdentityStore } from '../deviceIdentityStore.js';
import type { UserSecretRepository } from '../userSecretRepository.js';
import type { StoredUserSession, UserSessionRepository } from '../userSessionRepository.js';
import { createStoredUserSession } from '../userSessionRepository.js';

import type { PairingStatus } from './types.js';
import type { HandshakeMetadata } from './v2/proposal.js';
import type { DeviceIdentityForPairing } from './v2/service.js';
import { startPairingV2 } from './v2/service.js';
import type { HandshakeState, HandshakeSuccessState } from './v2/state.js';

export type HostMetadata = HandshakeMetadata;
export type AuthComponent = ReturnType<typeof createAuth>;

/**
 * Optional caller hook fired once the V2 handshake reaches Success, after the
 * SDK has persisted the session and secrets and before `authenticate()`
 * resolves. Receives both the persisted `StoredUserSession` and the sensitive
 * `identityChatPrivateKey` (which lives in `UserSecretRepository` and isn't
 * surfaced on the session shape). Throwing fails the `authenticate()` call.
 */
export type OnAuthSuccess = (event: {
  session: StoredUserSession;
  identityChatPrivateKey: Uint8Array;
  /**
   * `papp_encr_pub` from Mobile SSO spec v0.2.2. `null` when the peer
   * shipped a pre-v0.2.2 `HandshakeSuccessV2` body (no `sso_encr_pub_key`
   * field on the wire). The host's SSO session transport stays inactive
   * while null; chat is unaffected since it uses `identityChatPrivateKey`.
   */
  ssoEncPubKey: Uint8Array | null;
}) => Promise<void> | void;

type Params = {
  hostMetadata?: HostMetadata;
  /**
   * Optional override for the device identity. If absent, the SDK uses an
   * internal `deviceIdentityStore` backed by the host's `StorageAdapter` —
   * fine for web hosts. Electron / native consumers can plug in a Keychain-
   * backed identity by passing a factory that returns the same shape.
   */
  deviceIdentity?: () => Promise<DeviceIdentityForPairing> | DeviceIdentityForPairing;
  deviceIdentityStore: DeviceIdentityStore;
  statementStore: StatementStoreAdapter;
  ssoSessionRepository: UserSessionRepository;
  userSecretRepository: UserSecretRepository;
  onAuthSuccess?: OnAuthSuccess;
};

export function createAuth({
  hostMetadata,
  deviceIdentity,
  deviceIdentityStore,
  statementStore,
  ssoSessionRepository,
  userSecretRepository,
  onAuthSuccess,
}: Params) {
  const pairingStatus = createState<PairingStatus>({ step: 'none' });

  let authResult: ResultAsync<StoredUserSession | null, Error> | null = null;
  let abortHandle: (() => void) | null = null;

  return {
    pairingStatus: readonly(pairingStatus),

    authenticate(): ResultAsync<StoredUserSession | null, Error> {
      if (authResult) return authResult;

      const flowId = createFlowId();
      pairingStatus.write({ step: 'initial' });
      emitHostPappDebugMessage({
        layer: 'sso',
        event: 'pairing_started',
        flowId,
        timestamp: Date.now(),
        payload: { metadata: hostMetadata },
      });

      let aborted = false;
      let pairingAbort: (() => void) | null = null;
      abortHandle = () => {
        aborted = true;
        pairingAbort?.();
      };

      const resolveDeviceIdentity = (): ResultAsync<DeviceIdentityForPairing, Error> =>
        deviceIdentity
          ? ResultAsync.fromPromise(Promise.resolve(deviceIdentity()), toError)
          : deviceIdentityStore.loadOrCreate();

      const flow = ResultAsync.combine([
        resolveDeviceIdentity(),
        deviceIdentityStore.readLastProcessedHandshakeStatement(),
      ]).andThen(([identity, initialHex]) => {
        if (aborted) return okAsync<StoredUserSession | null, Error>(null);

        const pairing = startPairingV2({
          statementStore,
          deviceIdentity: identity,
          metadata: hostMetadata ?? {},
          initialProcessedDataHex: initialHex,
          onStatementProcessed: hex => {
            void deviceIdentityStore.writeLastProcessedHandshakeStatement(hex);
          },
        });
        pairingAbort = pairing.abort;

        pairingStatus.write({ step: 'pairing', payload: pairing.qrPayload });
        emitHostPappDebugMessage({
          layer: 'sso',
          event: 'deeplink_generated',
          flowId,
          timestamp: Date.now(),
          payload: { deeplink: pairing.qrPayload },
        });
        emitHostPappDebugMessage({
          layer: 'sso',
          event: 'awaiting_response',
          flowId,
          timestamp: Date.now(),
          payload: {},
        });

        return ResultAsync.fromPromise(
          new Promise<HandshakeSuccessState>((resolve, reject) => {
            let settled = false;
            const settle = (cb: () => void) => {
              if (settled) return;
              settled = true;
              cb();
            };
            const sub = pairing.state$.subscribe({
              next: state =>
                onState(
                  state,
                  s => settle(() => resolve(s)),
                  e => settle(() => reject(e)),
                  () => sub?.unsubscribe(),
                ),
              complete: () => {
                if (aborted) settle(() => reject(new AbortError('Aborted by user.')));
              },
              error: e => settle(() => reject(toError(e))),
            });
          }),
          toError,
        ).andThen(success => persistAndNotify(identity, success, flowId));
      });

      authResult = flow
        .orElse(e => (e instanceof AbortError ? okAsync<StoredUserSession | null, Error>(null) : errAsync(e)))
        .andTee(session => {
          if (session === null) {
            pairingStatus.reset();
          } else {
            pairingStatus.write({ step: 'finished', session });
            emitHostPappDebugMessage({
              layer: 'sso',
              event: 'session_established',
              flowId,
              timestamp: Date.now(),
              payload: { sessionId: session.id },
            });
          }
          abortHandle = null;
        })
        .orTee(e => {
          pairingStatus.write({ step: 'pairingError', message: e.message });
          emitHostPappDebugMessage({
            layer: 'sso',
            event: 'pairing_failed',
            flowId,
            timestamp: Date.now(),
            payload: { reason: e.message },
          });
          authResult = null;
          abortHandle = null;
        });

      return authResult;

      function onState(
        state: HandshakeState,
        resolve: (value: HandshakeSuccessState) => void,
        reject: (err: Error) => void,
        unsubscribe: () => void,
      ) {
        switch (state.tag) {
          case 'Idle':
          case 'Submitted':
            return;
          case 'Pending':
            pairingStatus.write({ step: 'pending', stage: state.reason });
            return;
          case 'Success':
            unsubscribe();
            emitHostPappDebugMessage({
              layer: 'sso',
              event: 'response_received',
              flowId,
              timestamp: Date.now(),
              payload: { identityAccountId: state.identityAccountId },
            });
            resolve(state);
            return;
          case 'Failed':
            unsubscribe();
            reject(new Error(state.reason));
            return;
        }
      }
    },

    abortAuthentication() {
      abortHandle?.();
      abortHandle = null;
      authResult = null;
      pairingStatus.reset();
    },
  };

  function persistAndNotify(
    identity: DeviceIdentityForPairing,
    success: HandshakeSuccessState,
    _flowId: string,
  ): ResultAsync<StoredUserSession, Error> {
    const localAccount = createLocalSessionAccount(createAccountId(identity.statementAccountPublicKey));
    const remoteAccount = createRemoteSessionAccount(
      createAccountId(success.peerStatementAccountId ?? new Uint8Array(32)),
      success.deviceEncPubKey,
    );
    const session = createStoredUserSession(
      localAccount,
      remoteAccount,
      createAccountId(success.rootAccountId ?? new Uint8Array(32)),
      {
        identityAccountId: createAccountId(success.identityAccountId),
        identityChatPublicKey: success.identityChatPublicKey,
        ssoEncPubKey: success.ssoEncPubKey ?? undefined,
      },
    );

    return userSecretRepository
      .write(session.id, {
        ssSecret: identity.statementAccountSecret as SsSecret,
        encrSecret: identity.encryptionPrivateKey as EncrSecret,
        entropy: new Uint8Array(0),
        identityChatPrivateKey: success.identityChatPrivateKey,
      })
      .andThen(() => ssoSessionRepository.add(session))
      .andThen(() =>
        onAuthSuccess
          ? ResultAsync.fromPromise(
              Promise.resolve(
                onAuthSuccess({
                  session,
                  identityChatPrivateKey: success.identityChatPrivateKey,
                  ssoEncPubKey: success.ssoEncPubKey,
                }),
              ),
              toError,
            ).map(() => session)
          : okAsync(session),
      );
  }
}
