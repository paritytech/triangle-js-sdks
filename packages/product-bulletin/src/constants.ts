import type { HexString } from '@novasamatech/host-api';

export const BulletinChain: Record<string, HexString> = {
  westend: '0xee1f44f62e68312c4852f37585941e9b64b5ceae539e4aa112ce9d3cf7bbe9fd',
  paseo: '0x744960c32e3a3df5440e1ecd4d34096f1ce2230d7016a5ada8a765d5a622b4ea',
  popStable: '0x6fdf4baff0328ddaca1812e6d2f8f26afc439e6e0a339c0094d17013f8da246d',
} as const;
