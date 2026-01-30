import type { PropsWithChildren } from 'react';
import { createContext, useContext, useMemo } from 'react';

export type Translations = {
  pairingHeader: string;
  pairingScanCallToAction: string;
  pairingDescription: string;
  pairingLoader: string;
  pairingAttestationError: string;
  pairingRetry: string;
  pairingError: string;
  pairingWelcomeMessage: string;
  pairingLoginMessage: string;
  pairingPopoverWelcome: string;
  pairingPopoverLoginHeading: string;
  pairingPopoverScanDescription: string;
};

export type TranslationsMap = Record<string, Translations>;

const defaultLanguage = 'en';

const defaultKeys: TranslationsMap = {
  [defaultLanguage]: {
    pairingHeader: 'Log in to save',
    pairingScanCallToAction: 'Scan it with a phone',
    pairingDescription:
      'Scanning the QR code opens the Polkadot mobile app, where users are guided step-by-step through the onboarding or setup process.',
    pairingLoader: 'Just a second...',
    pairingAttestationError: 'Error while passing attestation',
    pairingRetry: 'Retry',
    pairingError: 'Error while pairing',
    pairingWelcomeMessage: 'Welcome back,',
    pairingLoginMessage: 'Loggin in, {username}',
    pairingPopoverWelcome: 'Welcome to Polkadot, {username}',
    pairingPopoverLoginHeading: 'Login to explore all Polkadot features',
    pairingPopoverScanDescription: 'Scan with your phone camera to log in using the Polkadot mobile app',
  },
};

const Context = createContext<{ language: string; keys: TranslationsMap }>({
  language: defaultLanguage,
  keys: defaultKeys,
});

type Props = PropsWithChildren<{
  language?: string;
  keys?: TranslationsMap;
}>;

export const TranslationProvider = ({ language = defaultLanguage, keys, children }: Props) => {
  const value = useMemo(() => ({ language, keys: { ...defaultKeys, ...keys } }), [language, keys]);

  return <Context.Provider value={value}>{children}</Context.Provider>;
};

export const useTranslations = () => {
  const context = useContext(Context);

  const keys = context.keys[context.language];
  if (!keys) {
    throw new Error(`Papp integration: translation keys for "${context.language}" not found`);
  }

  return keys;
};
