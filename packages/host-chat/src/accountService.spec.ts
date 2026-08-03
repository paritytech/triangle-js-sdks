import type { Identity } from '@novasamatech/host-papp';
import { toHex } from '@novasamatech/scale';
import { okAsync } from 'neverthrow';
import { AccountId } from 'polkadot-api';
import { describe, expect, it, vi } from 'vitest';

import type { IdentitySource } from './accountService.js';
import { createAccountService } from './accountService.js';

const ADDRESS = '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY'; // Alice, SS58
const HEX_ACCOUNT_ID = toHex(AccountId().enc(ADDRESS));

function identityFor(accountId: string): Identity {
  return {
    accountId,
    fullUsername: 'alice',
    liteUsername: 'alice.01',
    credibility: { type: 'Lite' },
    identifierKey: `0x${'ab'.repeat(32)}`,
  };
}

const stubIdentity = (resolve: (accountId: string) => Identity | null) =>
  vi.fn<IdentitySource['getIdentity']>(accountId => okAsync(resolve(accountId)));

const serviceWith = (getIdentity: IdentitySource['getIdentity']) =>
  createAccountService({ identityEndpoint: 'https://example.invalid', identity: { getIdentity } });

describe('accountService.getConsumerInfo', () => {
  it('looks the account up by hex account id and returns its identity', async () => {
    const getIdentity = stubIdentity(identityFor);

    const result = await serviceWith(getIdentity).getConsumerInfo(ADDRESS);

    expect(getIdentity).toHaveBeenCalledWith(HEX_ACCOUNT_ID);
    expect(result._unsafeUnwrap()).toEqual(identityFor(HEX_ACCOUNT_ID));
  });

  it('resolves to null when the account has no consumer record', async () => {
    const service = serviceWith(stubIdentity(() => null));

    expect((await service.getConsumerInfo(ADDRESS))._unsafeUnwrap()).toBeNull();
  });

  it('reports a malformed address as an error rather than throwing', async () => {
    const getIdentity = stubIdentity(identityFor);

    const result = await serviceWith(getIdentity).getConsumerInfo('not-an-address');

    expect(result.isErr()).toBe(true);
    expect(getIdentity).not.toHaveBeenCalled();
  });
});
