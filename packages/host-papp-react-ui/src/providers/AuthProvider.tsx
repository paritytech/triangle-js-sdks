import type { AttestationStatus, PairingStatus, UserSession } from '@novasamatech/host-papp';
import type { PropsWithChildren } from 'react';
import { createContext, useCallback, useContext, useDebugValue, useState, useSyncExternalStore } from 'react';

import { usePapp } from '../flow/PappProvider.js';

export type AuthUIMode = 'popover' | 'modal' | null;

type Auth = {
  pairingStatus: PairingStatus;
  attestationStatus: AttestationStatus;
  pending: boolean;
  authUIMode: AuthUIMode;
  authenticate(ui?: AuthUIMode): Promise<void>;
  abortAuthentication(): void;
  disconnect(session: UserSession): Promise<void>;
};

const Context = createContext<Auth>({
  pairingStatus: { step: 'none' },
  attestationStatus: { step: 'none' },
  pending: false,
  authUIMode: null,
  authenticate: () => Promise.resolve(),
  abortAuthentication() {
    /* empty */
  },
  async disconnect() {
    /* empty */
  },
});

export const useAuthentication = () => {
  return useContext(Context);
};

const usePairingStatus = () => {
  const provider = usePapp();
  const pairingStatus = useSyncExternalStore(provider.sso.pairingStatus.subscribe, provider.sso.pairingStatus.read);

  useDebugValue(`Polkadot app pairing status: ${pairingStatus.step}`);

  return pairingStatus;
};

const useAttestationStatus = () => {
  const provider = usePapp();
  const attestationStatus = useSyncExternalStore(
    provider.sso.attestationStatus.subscribe,
    provider.sso.attestationStatus.read,
  );

  useDebugValue(`Polkadot app attestation status: ${attestationStatus.step}`);

  return attestationStatus;
};

export const AuthProvider = ({ children }: PropsWithChildren) => {
  const [pending, setPending] = useState(false);
  const [authUIMode, setAuthUIMode] = useState<AuthUIMode>(null);
  const provider = usePapp();

  const pairingStatus = usePairingStatus();
  const attestationStatus = useAttestationStatus();

  const authenticate = useCallback(
    (ui?: AuthUIMode) => {
      if (ui) {
        setAuthUIMode(ui);
      }
      setPending(true);
      return new Promise<void>((resolve, reject) => {
        provider.sso
          .authenticate()
          .andTee(() => setPending(false))
          .orTee(() => setPending(false))
          .match(() => resolve(), reject);
      });
    },
    [provider],
  );

  const abortAuthentication = useCallback(() => {
    setAuthUIMode(null);
    provider.sso.abortAuthentication();
  }, [provider]);

  const disconnect = useCallback(
    (session: UserSession) => {
      return new Promise<void>((resolve, reject) => provider.sessions.disconnect(session).match(resolve, reject));
    },
    [provider],
  );

  const state: Auth = {
    pending,
    pairingStatus,
    attestationStatus,
    authUIMode,
    authenticate,
    abortAuthentication,
    disconnect,
  };

  return <Context.Provider value={state}>{children}</Context.Provider>;
};
