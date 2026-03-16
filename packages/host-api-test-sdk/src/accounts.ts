import type { DevAccountInfo, DevAccountName } from './types.js';

export const DEV_ACCOUNTS: Record<DevAccountName, DevAccountInfo> = {
  alice: { name: 'Alice', uri: '//Alice' },
  bob: { name: 'Bob', uri: '//Bob' },
  charlie: { name: 'Charlie', uri: '//Charlie' },
  dave: { name: 'Dave', uri: '//Dave' },
  eve: { name: 'Eve', uri: '//Eve' },
  ferdie: { name: 'Ferdie', uri: '//Ferdie' },
};

export const DEV_ACCOUNT_NAMES = Object.keys(DEV_ACCOUNTS) as DevAccountName[];
