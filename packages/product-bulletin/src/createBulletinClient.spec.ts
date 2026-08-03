import type { BulletinTypedApi } from '@parity/bulletin-sdk';
import { describe, expect, it, vi } from 'vitest';

import { BulletinChain } from './constants.js';
import { createBulletinClient, withEntryRenew } from './createBulletinClient.js';

function stubApi() {
  const renew = vi.fn(() => 'renew-tx');
  const store = vi.fn(() => 'store-tx');
  const getValue = vi.fn(() => Promise.resolve(undefined));

  const api = {
    tx: { TransactionStorage: { renew, store } },
    query: { TransactionStorage: { Authorizations: { getValue } } },
  } as unknown as BulletinTypedApi;

  return { api, renew, store, getValue };
}

describe('withEntryRenew', () => {
  it('rewrites renew({ block, index }) into the Position entry enum', () => {
    const { api, renew } = stubApi();

    const result = withEntryRenew(api).tx.TransactionStorage.renew({ block: 7, index: 3 });

    expect(renew).toHaveBeenCalledWith({ entry: { type: 'Position', value: { block: 7, index: 3 } } });
    expect(result).toBe('renew-tx');
  });

  it('forwards every other call untouched', () => {
    const { api, store, getValue } = stubApi();
    const adapted = withEntryRenew(api);
    const data = new Uint8Array([1, 2, 3]);

    adapted.tx.TransactionStorage.store({ data });
    void adapted.query?.TransactionStorage.Authorizations.getValue({ type: 'Account', value: 'acc' });

    expect(store).toHaveBeenCalledWith({ data });
    expect(getValue).toHaveBeenCalledWith({ type: 'Account', value: 'acc' });
  });

  it('leaves the original api unmodified', () => {
    const { api, renew } = stubApi();

    withEntryRenew(api);
    api.tx.TransactionStorage.renew({ block: 7, index: 3 });

    expect(renew).toHaveBeenCalledWith({ block: 7, index: 3 });
  });
});

describe('createBulletinClient', () => {
  // Guessing the ABI wrong yields no type or client-side error — only an extrinsic the
  // chain rejects — so an unlisted chain has to be refused up front.
  it('refuses an unknown chain that does not declare its renew ABI', () => {
    expect(() =>
      createBulletinClient({
        genesisHash: `0x${'11'.repeat(32)}`,
        descriptor: BulletinChain.westend.descriptor,
        signer: {} as never,
      }),
    ).toThrow(/renewArgs/);
  });

  it('records a renew ABI for every known network', () => {
    for (const network of Object.values(BulletinChain)) {
      expect(network.renewArgs).toMatch(/^(block-index|entry)$/);
    }
  });
});
