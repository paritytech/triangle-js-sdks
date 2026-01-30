import { Button, Popover, ThemeProvider, defaultTheme } from '@novasamatech/tr-ui';
import type { PropsWithChildren } from 'react';
import { memo, useCallback, useEffect } from 'react';

import { useAuthStatus } from '../hooks/authStatus.js';
import { useAuthentication } from '../providers/AuthProvider.js';
import { useTranslations } from '../providers/TranslationProvider.js';
import { LogoSmall } from '../ui/LogoSmall.js';
import { QrCode } from '../ui/QrCode.js';

import styles from './Pairing.module.css';

type Props = PropsWithChildren<{
  theme?: 'light' | 'dark';
}>;

export const PairingPopover = memo(({ theme, children }: Props) => {
  const auth = useAuthentication();
  const { status } = useAuthStatus();

  const open = auth.authUIMode === 'popover' && status.step !== 'none';

  const handleTriggerClick = useCallback(() => {
    if (status.step === 'none') {
      auth.authenticate('popover');
    }
  }, [auth, status.step]);

  const togglePopover = useCallback(
    (newOpen: boolean) => {
      if (!newOpen && status.step !== 'attestation') {
        auth.abortAuthentication();
      }
    },
    [auth, status.step],
  );

  useEffect(() => {
    return () => {
      auth.abortAuthentication();
    };
  }, []);

  return (
    <ThemeProvider theme={defaultTheme} defaultMode={theme ?? 'light'}>
      <Popover open={open} onOpenChange={togglePopover}>
        <Popover.Trigger asChild>
          <div onClick={handleTriggerClick}>{children}</div>
        </Popover.Trigger>
        <Popover.Content
          className={styles.popoverContent}
          onInteractOutside={e => {
            if (status.step === 'attestation') {
              e.preventDefault();
            }
          }}
          onEscapeKeyDown={e => {
            if (status.step === 'attestation') {
              e.preventDefault();
            }
          }}
        >
          <div className={styles.popoverContainer}>
            {status.step === 'pairing' && <PairingStep payload={status.payload} />}
            {status.step === 'pairingError' && <PairingErrorStep message={status.message} />}
            {status.step === 'attestation' && <LoadingStep />}
            {status.step === 'attestationError' && <PairingErrorStep message={status.message} />}
          </div>
        </Popover.Content>
      </Popover>
    </ThemeProvider>
  );
});

const PairingStep = ({ payload }: { payload: string }) => {
  const { status } = useAuthStatus();
  const translation = useTranslations();
  const welcomeText = translation.pairingPopoverWelcome.replace('{username}', status.username || 'Guest');

  return (
    <div className={styles.pairingPopoverContainer}>
      <span className={styles.pairingPopoverHeader}>{welcomeText}</span>

      <div className={styles.qrContainer}>
        <QrCode value={payload} size={200} theme="dark" />
      </div>
      <span className={styles.scanCallToActionPopover}>{translation.pairingPopoverLoginHeading}</span>
      <span className={styles.pairingDescriptionPopover}>{translation.pairingPopoverScanDescription}</span>
    </div>
  );
};

const LoadingStep = () => {
  const { status } = useAuthStatus();
  const translation = useTranslations();
  const welcomeText = translation.pairingPopoverWelcome.replace('{username}', status.username || 'Guest');

  return (
    <div className={styles.loaderContainerPopover}>
      <span className={styles.pairingPopoverHeader}>{welcomeText}</span>
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
    <div className={styles.errorContainerPopover}>
      <span className={styles.errorTitlePopover}>{translation.pairingError}</span>
      {message && <span className={styles.errorGenericText}>{message}</span>}
      <Button variant="secondary" type="button" onClick={() => auth.authenticate()}>
        {translation.pairingRetry}
      </Button>
    </div>
  );
};
