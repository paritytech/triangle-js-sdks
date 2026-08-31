import type { HexString } from '@novasamatech/host-api';
import { createPapiProvider } from '@novasamatech/host-api-wrapper';
import type { ClientConfig } from '@parity/bulletin-sdk';
import { AsyncBulletinClient } from '@parity/bulletin-sdk';
import { createClient } from 'polkadot-api';
import type { TxCreator } from 'polkadot-api/tx-creator';

import { BulletinChain } from './constants.js';

/** Union of known Bulletin Chain descriptor types, derived from {@link BulletinChain}. */
export type BulletinDescriptor = (typeof BulletinChain)[keyof typeof BulletinChain]['descriptor'];

export interface CreateBulletinClientOptions {
  /** Bulletin Chain genesis hash — see {@link BulletinChain} for known networks */
  genesisHash: HexString;
  /** PAPI chain descriptor for the target network */
  descriptor: BulletinDescriptor;
  /** PAPI tx creator for transaction submission */
  signer: TxCreator;
  /** Optional AsyncBulletinClient config (chunk size, manifest behavior) */
  config?: Partial<ClientConfig>;
}

export function createBulletinClient(options: CreateBulletinClientOptions): AsyncBulletinClient {
  const { genesisHash, descriptor, signer, config } = options;

  const provider = createPapiProvider(genesisHash);
  const polkadotClient = createClient(provider);

  const api = polkadotClient.getTypedApi(descriptor);

  // TODO fix integration with new bulletin chain api
  return new AsyncBulletinClient(api as never, signer, polkadotClient.submit, config, () => polkadotClient.destroy());
}
