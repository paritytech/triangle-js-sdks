import type { Identity, UserSession } from '@novasamatech/host-papp';
import type { AccountId } from '@novasamatech/statement-store';
import { toHex } from '@polkadot-api/utils';
import { useEffect, useRef, useState } from 'react';

import { usePapp } from '../flow/PappProvider.js';

export function useIdentity(accountId: AccountId | null) {
  const papp = usePapp();
  const [pending, setPending] = useState(false);
  const [identity, setIdentity] = useState<Identity | null>(null);

  // Held in a ref so the effect's deps stay `[hexAccountId]` only. The papp
  // adapter is treated as stable for a provider's lifetime; if a consumer
  // recreates it per render, this hook still only re-subscribes when the
  // account changes — preventing chain-subscription churn on every parent
  // re-render.
  const pappRef = useRef(papp);
  pappRef.current = papp;

  const hexAccountId = accountId ? toHex(accountId) : null;

  useEffect(() => {
    // Clear the previously displayed identity immediately on account change
    // so the UI doesn't render the prior account's identity under the new
    // account while we wait for the first emission.
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
