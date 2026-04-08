import type { HexString } from '@novasamatech/host-api';
import { createPapiProvider } from '@novasamatech/product-sdk';
import type { BulletinTypedApi, ClientConfig, SubmitFn } from '@parity/bulletin-sdk';
import { AsyncBulletinClient } from '@parity/bulletin-sdk';
import type { PolkadotSigner } from 'polkadot-api';
import { createClient } from 'polkadot-api';

export interface CreateBulletinClientOptions {
  /** Bulletin Chain genesis hash */
  genesisHash: HexString;
  /** Signer from accountsProvider.getProductAccountSigner() */
  signer: PolkadotSigner;
  /** Optional AsyncBulletinClient config (chunk size, etc.) */
  config?: Partial<ClientConfig>;
}

export interface BulletinClientHandle {
  /** The AsyncBulletinClient instance */
  client: AsyncBulletinClient;
  /** Disconnect the underlying PolkadotClient */
  destroy: () => void;
}

export function createBulletinClient(options: CreateBulletinClientOptions): BulletinClientHandle {
  const { genesisHash, signer, config } = options;

  const provider = createPapiProvider(genesisHash);
  const polkadotClient = createClient(provider);

  const api = polkadotClient.getUnsafeApi() as unknown as BulletinTypedApi;
  const submit = polkadotClient.submit as unknown as SubmitFn;

  const client = new AsyncBulletinClient(api, signer, submit, config);

  return {
    client,
    destroy: () => polkadotClient.destroy(),
  };
}
