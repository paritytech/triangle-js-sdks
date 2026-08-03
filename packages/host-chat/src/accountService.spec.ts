import { toHex } from '@novasamatech/scale';
import type { LazyClient } from '@novasamatech/statement-store';
import { AccountId } from 'polkadot-api';
import { describe, expect, it, vi } from 'vitest';

import { createAccountService } from './accountService.js';

const ADDRESS = '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY'; // Alice, SS58
const KEY = 'ab'.repeat(32);

// Only the slice of `PolkadotClient` that the identity provider touches.
function stubClient(value: unknown) {
  const getValues = vi.fn(() => Promise.resolve([value]));
  const client = {
    getClient: () => ({ getUnsafeApi: () => ({ query: { Resources: { Consumers: { getValues } } } }) }),
  } as unknown as LazyClient;

  return { client, getValues };
}

describe('accountService.getConsumerInfo', () => {
  const consumer = {
    identifier_key: `0x00${KEY}${'00'.repeat(32)}`,
    full_username: new TextEncoder().encode('alice'),
    lite_username: new TextEncoder().encode('alice.01'),
    credibility: { type: 'Lite', value: undefined },
  };

  it('queries by SS58 address and keys the identity by hex account id', async () => {
    const { client, getValues } = stubClient(consumer);
    const service = createAccountService({ identityEndpoint: 'https://example.invalid', client });

    const result = await service.getConsumerInfo(ADDRESS);

    expect(getValues).toHaveBeenCalledWith([[ADDRESS]]);
    expect(result._unsafeUnwrap()).toEqual({
      accountId: toHex(AccountId().enc(ADDRESS)),
      fullUsername: 'alice',
      liteUsername: 'alice.01',
      credibility: { type: 'Lite' },
      identifierKey: `0x${KEY}`,
    });
  });

  it('resolves to null when the account has no consumer record', async () => {
    const { client } = stubClient(undefined);
    const service = createAccountService({ identityEndpoint: 'https://example.invalid', client });

    expect((await service.getConsumerInfo(ADDRESS))._unsafeUnwrap()).toBeNull();
  });

  it('reports a malformed address as an error rather than throwing', async () => {
    const { client, getValues } = stubClient(undefined);
    const service = createAccountService({ identityEndpoint: 'https://example.invalid', client });

    const result = await service.getConsumerInfo('not-an-address');

    expect(result.isErr()).toBe(true);
    expect(getValues).not.toHaveBeenCalled();
  });
});
