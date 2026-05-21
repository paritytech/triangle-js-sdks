import type { StatementStoreAdapter } from '@novasamatech/statement-store';
import { ResultAsync, errAsync, okAsync } from 'neverthrow';

import { createFlowId, emitHostPappDebugMessage } from '../../debugBus.js';
import { AbortError } from '../../helpers/abortError.js';
import { createState, readonly } from '../../helpers/state.js';
import { toError } from '../../helpers/utils.js';

import type { PairingStatus } from './types.js';
import type { HandshakeMetadata } from './v2/proposal.js';
import type { DeviceIdentityForPairing } from './v2/service.js';
import { startPairingV2 } from './v2/service.js';
import type { HandshakeState, HandshakeSuccessState } from './v2/state.js';

export type HostMetadata = HandshakeMetadata;
export type AuthComponent = ReturnType<typeof createAuth>;

export type AuthSuccess = HandshakeSuccessState;

type Params = {
  hostMetadata?: HostMetadata;
  /**
   * Persistent device identity used for the pairing. The same identity must be
   * reused across launches so PApp recognises this device as the same peer
   * (per-device chat addressing depends on `encryptionPublicKey`). Caller owns
   * the persistence; the factory is invoked on each `authenticate()` so the
   * SDK never holds key material between attempts.
   */
  deviceIdentity: () => Promise<DeviceIdentityForPairing> | DeviceIdentityForPairing;
  statementStore: StatementStoreAdapter;
  /**
   * Fires once the V2 handshake reaches `Success`, before `authenticate()`
   * resolves. Use it for consumer-specific bookkeeping (peer-device
   * registration, contact reset, telemetry). Throwing fails the
   * `authenticate()` call and surfaces as `pairingError`.
   */
  persistOnSuccess?: (success: AuthSuccess) => Promise<void>;
  /**
   * Hex of the last pairing-topic statement this device processed (so a stale
   * `Success` doesn't get replayed on the next launch / re-pair). Resolved per
   * `authenticate()` so a value freshly written by `onStatementProcessed` on
   * one attempt is visible to the next.
   */
  initialProcessedDataHex?: () => Promise<string | null> | string | null;
  onStatementProcessed?: (dataHex: string) => void;
};

export function createAuth({
  hostMetadata,
  deviceIdentity,
  statementStore,
  persistOnSuccess,
  initialProcessedDataHex,
  onStatementProcessed,
}: Params) {
  const pairingStatus = createState<PairingStatus>({ step: 'none' });

  let authResult: ResultAsync<AuthSuccess | null, Error> | null = null;
  let abortHandle: (() => void) | null = null;

  return {
    pairingStatus: readonly(pairingStatus),

    authenticate(): ResultAsync<AuthSuccess | null, Error> {
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

      const flow = ResultAsync.fromPromise(
        Promise.all([Promise.resolve(deviceIdentity()), Promise.resolve(initialProcessedDataHex?.() ?? null)]),
        toError,
      ).andThen(([identity, initialHex]) => {
        if (aborted) return okAsync<AuthSuccess | null, Error>(null);

        const pairing = startPairingV2({
          statementStore,
          deviceIdentity: identity,
          metadata: hostMetadata ?? {},
          initialProcessedDataHex: initialHex,
          onStatementProcessed,
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
          new Promise<AuthSuccess>((resolve, reject) => {
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
                  flowId,
                ),
              complete: () => {
                if (aborted) settle(() => reject(new AbortError('Aborted by user.')));
              },
              error: e => settle(() => reject(toError(e))),
            });
          }),
          toError,
        );
      });

      authResult = flow
        .orElse(e => (e instanceof AbortError ? okAsync<AuthSuccess | null, Error>(null) : errAsync(e)))
        .andTee(success => {
          if (success === null) {
            pairingStatus.reset();
          } else {
            pairingStatus.write({ step: 'finished' });
            emitHostPappDebugMessage({
              layer: 'sso',
              event: 'session_established',
              flowId,
              timestamp: Date.now(),
              payload: { identityAccountId: success.identityAccountId },
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
        resolve: (value: AuthSuccess) => void,
        reject: (err: Error) => void,
        unsubscribe: () => void,
        flowId: string,
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
            if (persistOnSuccess) {
              persistOnSuccess(state).then(
                () => resolve(state),
                e => reject(toError(e)),
              );
            } else {
              resolve(state);
            }
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
}
