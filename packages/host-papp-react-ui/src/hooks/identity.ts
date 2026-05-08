import type { Identity, UserSession } from '@novasamatech/host-papp';
import type { AccountId } from '@novasamatech/statement-store';
import { toHex } from '@polkadot-api/utils';
import { useEffect, useState } from 'react';

import { usePapp } from '../flow/PappProvider.js';

export function useIdentity(accountId: AccountId | null) {
  const papp = usePapp();
  const [pending, setPending] = useState(false);
  const [identity, setIdentity] = useState<Identity | null>(null);

  const hexAccountId = accountId ? toHex(accountId) : null;

  useEffect(() => {
    if (!hexAccountId) {
      setPending(false);
      return;
    }

    let mounted = true;

    setPending(true);
    papp.identity.getIdentity(hexAccountId).match(
      identity => {
        if (mounted) {
          setIdentity(identity);
          setPending(false);
        }
      },
      () => {
        if (mounted) {
          setIdentity(null);
          setPending(false);
        }
      },
    );

    return () => {
      setPending(false);
      mounted = false;
    };
  }, [hexAccountId]);

  return [identity, pending] as const;
}

export function useSessionIdentity(session: UserSession | null) {
  return useIdentity(session ? session.remoteAccount.accountId : null);
}
