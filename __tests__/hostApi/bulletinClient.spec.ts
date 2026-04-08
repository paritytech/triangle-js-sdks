import { BulletinChain, createBulletinClient } from '@novasamatech/product-bulletin';
import { createPapiProvider } from '@novasamatech/product-sdk';

import { AsyncBulletinClient } from '@parity/bulletin-sdk';
import type { PolkadotSigner } from 'polkadot-api';
import { createClient } from 'polkadot-api';
import type { MockInstance } from 'vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Mock modules before imports — vitest hoists vi.mock calls automatically
vi.mock('@novasamatech/product-sdk', () => ({
  createPapiProvider: vi.fn(() => 'mock-provider'),
}));

vi.mock('polkadot-api', () => ({
  createClient: vi.fn(() => ({
    getUnsafeApi: vi.fn(() => 'mock-api'),
    submit: 'mock-submit',
    destroy: vi.fn(),
  })),
}));

vi.mock('@parity/bulletin-sdk', () => ({
  AsyncBulletinClient: vi.fn(),
}));

const mockSigner = {} as PolkadotSigner;

describe('Product Bulletin: createBulletinClient', () => {
  afterEach(() => vi.clearAllMocks());

  it('passes genesis hash to createPapiProvider', () => {
    createBulletinClient({ genesisHash: BulletinChain.westend, signer: mockSigner });

    expect(createPapiProvider).toHaveBeenCalledWith(BulletinChain.westend);
  });

  it('creates polkadot client from the provider', () => {
    createBulletinClient({ genesisHash: BulletinChain.westend, signer: mockSigner });

    expect(createClient).toHaveBeenCalledWith('mock-provider');
  });

  it('constructs AsyncBulletinClient with api, signer, submit, and config', () => {
    const config = { chunkSize: 512 };
    createBulletinClient({ genesisHash: BulletinChain.paseo, signer: mockSigner, config });

    expect(AsyncBulletinClient).toHaveBeenCalledWith('mock-api', mockSigner, 'mock-submit', config);
  });

  it('returns a handle with client and destroy', () => {
    const handle = createBulletinClient({ genesisHash: BulletinChain.westend, signer: mockSigner });

    expect(handle.client).toBeInstanceOf(AsyncBulletinClient);
    expect(handle.destroy).toBeTypeOf('function');
  });

  it('destroy() disconnects the underlying polkadot client', () => {
    const handle = createBulletinClient({ genesisHash: BulletinChain.westend, signer: mockSigner });

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const mockPolkadotClient = (createClient as unknown as MockInstance).mock.results[0]!.value;
    handle.destroy();

    expect(mockPolkadotClient.destroy).toHaveBeenCalledOnce();
  });
});
