import * as Popover from '@radix-ui/react-popover';
import { ALIGN_OPTIONS, SIDE_OPTIONS } from '@radix-ui/react-popper';
import type { PropsWithChildren } from 'react';
import { memo, useCallback, useEffect } from 'react';

import { useAuthStatus } from '../hooks/authStatus.js';
import { useAuthentication } from '../providers/AuthProvider.js';
import { useTranslations } from '../providers/TranslationProvider.js';
import { LogoSmall } from '../ui/LogoSmall.js';
import { QrCode } from '../ui/QrCode.js';

import styles from './Pairing.module.css';

type Side = (typeof SIDE_OPTIONS)[number];
type Align = (typeof ALIGN_OPTIONS)[number];

type Props = PropsWithChildren<{
  theme?: 'light' | 'dark';
  size?: number;
  side?: Side;
  sizeOffset?: number;
  align?: Align;
  alignOffset?: number;
}>;

export const PairingPopover = memo(
  ({ theme = 'dark', size = 240, align, side, alignOffset, sizeOffset = 4, children }: Props) => {
    const auth = useAuthentication();
    const { status } = useAuthStatus();

    const isStorybook = typeof process !== 'undefined' && process.env?.STORYBOOK === 'true';

    const open = auth.authUIMode === 'popover' && (isStorybook || status.step !== 'none');

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
    }, [auth]);

    return (
      <Popover.Root open={open} onOpenChange={togglePopover}>
        <Popover.Trigger asChild onClick={handleTriggerClick}>
          {children}
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            side={side}
            align={align}
            sideOffset={sizeOffset}
            alignOffset={alignOffset}
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
              {status.step === 'pairing' && <PairingStep theme={theme} size={size} payload={status.payload} />}
              {status.step === 'pairingError' && <PairingErrorStep message={status.message} />}
              {status.step === 'attestation' && <LoadingStep />}
              {status.step === 'attestationError' && <PairingErrorStep message={status.message} />}
            </div>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    );
  },
);

const PairingStep = ({
  payload,
  size,
  theme = 'light',
}: {
  payload: string;
  size: number;
  theme?: 'light' | 'dark';
}) => {
  const translation = useTranslations();

  return (
    <div className={styles.pairingPopoverContainer}>
      <span className={styles.pairingPopoverHeader}>{translation.pairingPopoverWelcome}</span>
      <QrCode value={payload} size={size} theme={theme} />
      <span className={styles.scanCallToActionPopover}>{translation.pairingPopoverLoginHeading}</span>
      <span className={styles.pairingDescriptionPopover}>{translation.pairingPopoverScanDescription}</span>
    </div>
  );
};

const LoadingStep = () => {
  const translation = useTranslations();

  return (
    <div className={styles.loaderContainerPopover}>
      <span className={styles.pairingPopoverHeader}>{translation.pairingPopoverWelcome}</span>
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
      <button className={styles.retryButton} type="button" onClick={() => auth.authenticate()}>
        {translation.pairingRetry}
      </button>
    </div>
  );
};
