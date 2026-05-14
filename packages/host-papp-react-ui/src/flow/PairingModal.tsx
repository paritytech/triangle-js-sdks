import { Button } from '@novasamatech/tr-ui';
import { memo, useEffect } from 'react';

import { useAuthStatus } from '../hooks/authStatus.js';
import { useAuthentication } from '../providers/AuthProvider.js';
import { useTranslations } from '../providers/TranslationProvider.js';
import { LogoSmall } from '../ui/LogoSmall.js';
import { Modal } from '../ui/Modal.js';
import { QrCode } from '../ui/QrCode.js';

import styles from './Pairing.module.css';

type Props = {
  theme?: 'light' | 'dark';
  size?: number;
};

export const PairingModal = memo(({ theme, size = 280 }: Props = {}) => {
  const auth = useAuthentication();
  const { status } = useAuthStatus();

  const open = auth.authUIMode === 'modal' && status.step !== 'none' && status.step !== 'finished';

  const toggleModal = (newOpen: boolean) => {
    if (!newOpen && status.step !== 'attestation') {
      auth.abortAuthentication();
    }
  };

  useEffect(() => {
    if (auth.authUIMode === 'modal' && status.step === 'finished') {
      auth.abortAuthentication();
    }
  }, [auth, status.step]);

  return (
    <Modal open={open} onOpenChange={toggleModal} width="fit-content">
      <div className={styles.container}>
        {status.step === 'pairing' && <PairingStep theme={theme} size={size} payload={status.payload} />}
        {status.step === 'pairingError' && <PairingErrorStep message={status.message} />}
        {status.step === 'attestation' && <LoadingStep />}
        {status.step === 'attestationError' && <PairingErrorStep message={status.message} />}
      </div>
    </Modal>
  );
});

const PairingStep = ({ payload, size, theme }: { payload: string; size: number; theme?: 'light' | 'dark' }) => {
  const translation = useTranslations();
  const isDark = theme === 'dark';

  return (
    <div className={styles.pairingContainer}>
      <span className={styles.pairingHeader}>{translation.pairingHeader}</span>
      <span className={styles.scanCallToAction}>{translation.pairingScanCallToAction}</span>
      <div className={isDark ? styles.qrSurfaceDark : styles.qrSurfaceLight}>
        <QrCode value={payload} size={size} theme={theme} />
      </div>
      <span className={styles.pairingDescription}>{translation.pairingDescription}</span>
    </div>
  );
};

const LoadingStep = () => {
  const translation = useTranslations();

  return (
    <div className={styles.loaderContainer}>
      <span className={styles.loaderHeader}>{translation.pairingLoginMessage}</span>
      <div className={styles.loaderLogo}>
        <LogoSmall size={100} />
      </div>
      <span className={styles.loaderText}>{translation.pairingLoader}</span>
    </div>
  );
};

const PairingErrorStep = ({ message }: { message: string }) => {
  const auth = useAuthentication();
  const translation = useTranslations();

  return (
    <div className={styles.errorContainer}>
      <span className={styles.errorTitle}>{translation.pairingError}</span>
      <span className={styles.errorGenericText}>{message}</span>
      <Button variant="secondary" type="button" onClick={() => auth.authenticate()}>
        {translation.pairingRetry}
      </Button>
    </div>
  );
};
