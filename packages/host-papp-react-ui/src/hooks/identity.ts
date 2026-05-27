import type { Identity, UserSession } from '@novasamatech/host-papp';
import type { AccountId } from '@novasamatech/statement-store';
import { toHex } from '@polkadot-api/utils';
import { useEffect, useRef, useState } from 'react';

import { usePapp } from '../flow/PappProvider.js';

export function useIdentity(accountId: AccountId | null) {
  const papp = usePapp();
  const [pending, setPending] = useState(false);
  const [identity, setIdentity] = useState<Identity | null>(null);

  // Ref keeps the effect deps to `[hexAccountId]` so a re-rendered papp
  // adapter doesn't trigger chain-subscription churn.
  const pappRef = useRef(papp);
  pappRef.current = papp;

  const hexAccountId = accountId ? toHex(accountId) : null;

  useEffect(() => {
    // Clear stale identity so the new account doesn't briefly show the old one.
    setIdentity(null);

    if (!hexAccountId) {
      setPending(false);
      return;
    }

    setPending(true);

    const subscription = pappRef.current.identity.watchIdentity(hexAccountId).subscribe({
      next: value => {
        setIdentity(value);
        setPending(false);
      },
      error: () => {
        setIdentity(null);
        setPending(false);
      },
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [hexAccountId]);

  return [identity, pending] as const;
}

export function useSessionIdentity(session: UserSession | null) {
  return useIdentity(session ? session.remoteAccount.accountId : null);
}
