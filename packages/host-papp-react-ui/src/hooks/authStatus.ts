import { useMemo } from 'react';

import { useAuthentication } from '../providers/AuthProvider.js';

export const useAuthStatus = () => {
  const { pairingStatus } = useAuthentication();

  const signedInUser = useMemo(() => {
    if (pairingStatus.step === 'finished') {
      return pairingStatus.session;
    }
    return null;
  }, [pairingStatus]);

  return {
    status: pairingStatus,
    signedInUser,
  };
};
