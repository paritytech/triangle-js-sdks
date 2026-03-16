import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DEV_ACCOUNTS } from './accounts.js';
import type { ChainConfig, DevAccountName } from './types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

let bundleCache: string | null = null;

function getBundleScript(): string {
  if (!bundleCache) {
    bundleCache = readFileSync(join(__dirname, 'host-bundle.js'), 'utf-8');
  }
  return bundleCache;
}

interface HostPageConfig {
  productUrl: string;
  accounts: DevAccountName[];
  chain: ChainConfig;
}

export function generateHostPage(config: HostPageConfig): string {
  const { productUrl, accounts, chain } = config;

  const accountConfigs = accounts.map(name => {
    const info = DEV_ACCOUNTS[name];
    return { name: info.name, uri: info.uri };
  });

  const configJson = JSON.stringify({
    productUrl,
    accounts: accountConfigs,
    chain: {
      genesisHash: chain.genesisHash,
      rpcUrl: chain.rpcUrl,
      name: chain.name,
    },
  });

  const bundleScript = getBundleScript();

  // Escape closing script tags to prevent breaking out of inline script
  const safeConfigJson = configJson.replace(/<\//g, '<\\/');

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Test Host</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { width: 100%; height: 100%; overflow: hidden; }
    iframe { width: 100%; height: 100%; border: none; }
  </style>
</head>
<body>
  <iframe id="product-frame" sandbox="allow-scripts allow-same-origin allow-forms allow-popups"></iframe>
  <script>window.__TEST_HOST_CONFIG__ = ${safeConfigJson};</script>
  <script>${bundleScript}</script>
</body>
</html>`;
}
