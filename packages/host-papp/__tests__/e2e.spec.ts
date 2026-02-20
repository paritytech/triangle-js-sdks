import { toHex } from '@novasamatech/scale';
import { createLazyClient } from '@novasamatech/statement-store';
import { getWsProvider } from '@polkadot-api/ws-provider';
import { generateMnemonic } from '@polkadot-labs/hdkd-helpers';
import { describe, it } from 'vitest';

import { SS_PREVIEW_STAGE_ENDPOINTS } from '../src/constants.js';
import { deriveSr25519Account } from '../src/crypto.js';
import { createAttestationService, createSudoAliceVerifier } from '../src/sso/auth/attestationService.js';

describe('PAPP e2e', () => {
  it(
    'should attest account',
    async () => {
      const lazyClient = createLazyClient(getWsProvider(SS_PREVIEW_STAGE_ENDPOINTS));
      const attestationService = createAttestationService(lazyClient);

      const verifier = createSudoAliceVerifier();
      const username = attestationService.claimUsername();
      const mnemonic = 'north inject wheat radar anchor odor bid argue domain critic follow unveil';
      const account = deriveSr25519Account(generateMnemonic(), '//wallet//sso');

      await attestationService.registerLitePerson(username, account, verifier);

      console.log('username', username);
      console.log('mnemonic', mnemonic);
      console.log('account private', toHex(account.secret));
      console.log('account', toHex(account.publicKey));
    },
    1000 * 1000,
  );
});
