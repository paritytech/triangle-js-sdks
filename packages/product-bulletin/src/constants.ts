import type { HexString } from '@novasamatech/host-api';
import type { ChainDefinition } from 'polkadot-api';

import {
  bulletin_paseo,
  bulletin_pop_stable,
  bulletin_previewnet,
  bulletin_westend,
} from '../.papi/descriptors/dist/index.js';

export interface BulletinNetwork {
  genesisHash: HexString;
  descriptor: ChainDefinition;
}

/** Known Bulletin Chain networks with genesis hashes and PAPI descriptors. */
export const BulletinChain = {
  westend: {
    genesisHash: '0xee1f44f62e68312c4852f37585941e9b64b5ceae539e4aa112ce9d3cf7bbe9fd',
    descriptor: bulletin_westend,
  },
  paseo: {
    genesisHash: '0xe101f0fa4627d29a257645e02be86d80378fea1a2bf8fa6a918d150ebc760a59',
    descriptor: bulletin_paseo,
  },
  // Repointed off the retired pop3 testnet onto Paseo Bulletin Next; the key name no
  // longer describes the chain, kept to avoid a rename on top of the genesis change.
  popStable: {
    genesisHash: '0x8cfe6717dc4becfda2e13c488a1e2061ff2dfee96e7d031157f72d36716c0a22',
    descriptor: bulletin_pop_stable,
  },
  previewnet: {
    genesisHash: '0x2778b1c94c4362e49a54be57d3056bc714f3712e4486625312704ffb74eb973d',
    descriptor: bulletin_previewnet,
  },
} as const satisfies Record<string, BulletinNetwork>;
