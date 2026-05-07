import type { HexString } from '@novasamatech/host-api';
import { createPapiProvider } from '@novasamatech/product-sdk';
import type { ClientConfig } from '@parity/bulletin-sdk';
import { AsyncBulletinClient } from '@parity/bulletin-sdk';
import type { PolkadotSigner } from 'polkadot-api';
import { createClient } from 'polkadot-api';

import { BulletinChain } from './constants.js';

/** Union of known Bulletin Chain descriptor types, derived from {@link BulletinChain}. */
export type BulletinDescriptor = (typeof BulletinChain)[keyof typeof BulletinChain]['descriptor'];

export interface CreateBulletinClientOptions {
  /** Bulletin Chain genesis hash — see {@link BulletinChain} for known networks */
  genesisHash: HexString;
  /** PAPI chain descriptor for the target network */
  descriptor: BulletinDescriptor;
  /** PAPI signer for transaction submission */
  signer: PolkadotSigner;
  /** Optional AsyncBulletinClient config (chunk size, manifest behavior) */
  config?: Partial<ClientConfig>;
}

export function createBulletinClient(options: CreateBulletinClientOptions): AsyncBulletinClient {
  const { genesisHash, descriptor, signer, config } = options;

  const provider = createPapiProvider(genesisHash);
  const polkadotClient = createClient(provider);

  const api = polkadotClient.getTypedApi(descriptor);

  return new AsyncBulletinClient(api, signer, polkadotClient.submit, config, () => polkadotClient.destroy());
}
