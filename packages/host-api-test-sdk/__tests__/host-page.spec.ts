import { afterAll, describe, expect, it } from 'vitest';

import type { TestHostServer } from '../dist/index.js';
import { DEV_ACCOUNTS, PASEO_ASSET_HUB, PREVIEWNET, SUPPORTED_CHAINS, createTestHostServer } from '../dist/index.js';

describe('host page generation', () => {
  const servers: TestHostServer[] = [];

  async function fetchPage(options: Parameters<typeof createTestHostServer>[0]): Promise<string> {
    const server = await createTestHostServer(options);
    servers.push(server);
    const res = await fetch(server.url);
    return res.text();
  }

  interface EmbeddedConfig {
    productUrl: string;
    accounts: Array<{ name: string; uri: string }>;
    chain: { genesisHash: string; rpcUrl: string; name: string };
  }

  function extractConfig(html: string): EmbeddedConfig {
    const match = html.match(/window\.__TEST_HOST_CONFIG__\s*=\s*({.*?});/);
    if (!match?.[1]) throw new Error('Config not found in HTML');
    return JSON.parse(match[1]) as EmbeddedConfig;
  }

  afterAll(async () => {
    await Promise.all(servers.map(s => s.close()));
  });

  describe('account config embedding', () => {
    it('embeds all 6 dev accounts when requested', async () => {
      const html = await fetchPage({
        productUrl: 'http://localhost:3000',
        accounts: ['alice', 'bob', 'charlie', 'dave', 'eve', 'ferdie'],
      });

      const config = extractConfig(html);

      expect(config.accounts).toHaveLength(6);
      expect(config.accounts).toEqual([
        { name: 'Alice', uri: '//Alice' },
        { name: 'Bob', uri: '//Bob' },
        { name: 'Charlie', uri: '//Charlie' },
        { name: 'Dave', uri: '//Dave' },
        { name: 'Eve', uri: '//Eve' },
        { name: 'Ferdie', uri: '//Ferdie' },
      ]);
    });

    it('defaults to alice when no accounts specified', async () => {
      const html = await fetchPage({
        productUrl: 'http://localhost:3000',
      });

      const config = extractConfig(html);

      expect(config.accounts).toEqual([{ name: 'Alice', uri: '//Alice' }]);
    });
  });

  describe('chain config embedding', () => {
    it('embeds Paseo Asset Hub by default', async () => {
      const html = await fetchPage({
        productUrl: 'http://localhost:3000',
      });

      const config = extractConfig(html);

      expect(config.chain.genesisHash).toBe(PASEO_ASSET_HUB.genesisHash);
      expect(config.chain.rpcUrl).toBe(PASEO_ASSET_HUB.rpcUrl);
      expect(config.chain.name).toBe(PASEO_ASSET_HUB.name);
    });

    it('embeds custom chain config when provided', async () => {
      const html = await fetchPage({
        productUrl: 'http://localhost:3000',
        chain: PREVIEWNET,
      });

      const config = extractConfig(html);

      expect(config.chain.genesisHash).toBe(PREVIEWNET.genesisHash);
      expect(config.chain.rpcUrl).toBe(PREVIEWNET.rpcUrl);
      expect(config.chain.name).toBe(PREVIEWNET.name);
    });
  });

  describe('bundle integrity', () => {
    it('bundle contains host-container integration (product-frame and control API)', async () => {
      const html = await fetchPage({
        productUrl: 'http://localhost:3000',
      });

      // product-frame is the iframe ID used by the container to communicate with the product
      expect(html).toContain('product-frame');
      // __TEST_HOST__ is the control API exposed to Playwright
      expect(html).toContain('__TEST_HOST__');
    });

    it('bundle contains signing handler references', async () => {
      const html = await fetchPage({
        productUrl: 'http://localhost:3000',
      });

      // Verify the signing handlers are present in the bundle
      expect(html).toContain('handleSignPayload');
      expect(html).toContain('handleSignRaw');
    });

    it('bundle contains account handler references', async () => {
      const html = await fetchPage({
        productUrl: 'http://localhost:3000',
      });

      expect(html).toContain('handleGetNonProductAccounts');
      expect(html).toContain('handleAccountConnectionStatusSubscribe');
    });

    it('bundle contains chain connection handler', async () => {
      const html = await fetchPage({
        productUrl: 'http://localhost:3000',
      });

      expect(html).toContain('handleChainConnection');
      expect(html).toContain('handleFeatureSupported');
    });

    it('bundle contains localStorage handlers', async () => {
      const html = await fetchPage({
        productUrl: 'http://localhost:3000',
      });

      expect(html).toContain('handleLocalStorageRead');
      expect(html).toContain('handleLocalStorageWrite');
      expect(html).toContain('handleLocalStorageClear');
    });

    it('bundle contains crypto and keyring imports', async () => {
      const html = await fetchPage({
        productUrl: 'http://localhost:3000',
      });

      // Verify sr25519 crypto is bundled (critical for auto-signing)
      expect(html).toContain('sr25519');
      // Verify ExtrinsicPayload is present (needed for payload signing)
      expect(html).toContain('ExtrinsicPayload');
    });
  });

  describe('server options', () => {
    it('listens on specified port', async () => {
      const server = await createTestHostServer({
        productUrl: 'http://localhost:3000',
        port: 0, // random port
      });
      servers.push(server);

      expect(server.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    });

    it('can start multiple servers on different ports', async () => {
      const server1 = await createTestHostServer({
        productUrl: 'http://localhost:3000',
      });
      const server2 = await createTestHostServer({
        productUrl: 'http://localhost:3001',
      });
      servers.push(server1, server2);

      expect(server1.url).not.toBe(server2.url);

      const html1 = await (await fetch(server1.url)).text();
      const html2 = await (await fetch(server2.url)).text();

      expect(html1).toContain('http://localhost:3000');
      expect(html2).toContain('http://localhost:3001');
    });

    it('server closes cleanly', async () => {
      const server = await createTestHostServer({
        productUrl: 'http://localhost:3000',
      });

      // Verify it works
      const res = await fetch(server.url);
      expect(res.status).toBe(200);

      // Close and verify it's down
      await server.close();

      await expect(fetch(server.url)).rejects.toThrow();
    });
  });

  describe('data exports', () => {
    it('DEV_ACCOUNTS has all 6 accounts', () => {
      expect(Object.keys(DEV_ACCOUNTS)).toEqual(['alice', 'bob', 'charlie', 'dave', 'eve', 'ferdie']);
    });

    it('each DEV_ACCOUNT has name and uri', () => {
      for (const [key, account] of Object.entries(DEV_ACCOUNTS)) {
        expect(account.name).toBe(key.charAt(0).toUpperCase() + key.slice(1));
        expect(account.uri).toBe(`//${key.charAt(0).toUpperCase() + key.slice(1)}`);
      }
    });

    it('SUPPORTED_CHAINS includes all built-in chains', () => {
      expect(SUPPORTED_CHAINS).toHaveLength(3);
      expect(SUPPORTED_CHAINS.map(c => c.id)).toEqual(['paseo-asset-hub', 'previewnet', 'previewnet-asset-hub']);
    });

    it('all chain configs have valid genesis hash format', () => {
      for (const chain of SUPPORTED_CHAINS) {
        expect(chain.genesisHash).toMatch(/^0x[a-f0-9]{64}$/);
        expect(chain.rpcUrl).toMatch(/^wss?:\/\//);
        expect(chain.tokenDecimals).toBeGreaterThan(0);
        expect(chain.tokenSymbol.length).toBeGreaterThan(0);
      }
    });
  });
});
