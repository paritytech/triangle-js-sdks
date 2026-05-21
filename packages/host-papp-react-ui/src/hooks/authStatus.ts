import { useAuthentication } from '../providers/AuthProvider.js';

export const useAuthStatus = () => {
  const { pairingStatus } = useAuthentication();

  return {
    status: pairingStatus,
    isSignedIn: pairingStatus.step === 'finished',
  };
};
