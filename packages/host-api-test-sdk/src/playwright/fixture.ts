import type { FrameLocator, Page } from '@playwright/test';

import { DEFAULT_CHAIN } from '../chains.js';
import { createTestHostServer } from '../server.js';
import type { CreateTestHostOptions, DevAccountName, SigningLogEntry } from '../types.js';

export interface TestHost {
  /** The host page (contains the iframe) */
  page: Page;

  /** FrameLocator for the embedded product iframe */
  productFrame(): FrameLocator;

  /** Dispose container and recreate with a single account (iframe reloads) */
  switchAccount(name: DevAccountName): Promise<void>;

  /** Dispose container and recreate with multiple accounts (iframe reloads) */
  setAccounts(names: DevAccountName[]): Promise<void>;

  /** All auto-signed payloads since last clear */
  getSigningLog(): Promise<SigningLogEntry[]>;

  /** Clear the signing log */
  clearSigningLog(): Promise<void>;

  /** Wait until the product-sdk has connected to the host container */
  waitForConnection(timeout?: number): Promise<void>;
}

export interface TestHostFixtureOptions {
  /** URL of the product to test */
  productUrl: string;
  /** Initial accounts (default: ['alice']) */
  accounts?: DevAccountName[];
  /** Chain config (default: PASEO_ASSET_HUB) */
  chain?: CreateTestHostOptions['chain'];
}

export function createTestHostFixture(defaults: TestHostFixtureOptions) {
  return {
    testHost: async ({ page }: { page: Page }, use: (fixture: TestHost) => Promise<void>) => {
      const server = await createTestHostServer({
        productUrl: defaults.productUrl,
        accounts: defaults.accounts ?? ['alice'],
        chain: defaults.chain ?? DEFAULT_CHAIN,
      });

      await page.goto(server.url);

      // Wait for browser runtime to finish async init (cryptoWaitReady + container setup)
      await page.waitForFunction(() => !!window.__TEST_HOST__, { timeout: 30_000 });

      const testHost: TestHost = {
        page,

        productFrame() {
          return page.frameLocator('#product-frame');
        },

        async switchAccount(name: DevAccountName) {
          await page.evaluate(n => window.__TEST_HOST__.switchAccount(n), name);
          // Wait for iframe to reload
          await page.frameLocator('#product-frame').locator('body').waitFor({ state: 'attached' });
        },

        async setAccounts(names: DevAccountName[]) {
          await page.evaluate(n => window.__TEST_HOST__.setAccounts(n), names);
          await page.frameLocator('#product-frame').locator('body').waitFor({ state: 'attached' });
        },

        async getSigningLog() {
          return page.evaluate(() => window.__TEST_HOST__.getSigningLog());
        },

        async clearSigningLog() {
          await page.evaluate(() => window.__TEST_HOST__.clearSigningLog());
        },

        async waitForConnection(timeout = 30_000) {
          await page.waitForFunction(() => window.__TEST_HOST__?.getConnectionStatus() === 'connected', { timeout });
        },
      };

      await use(testHost);

      // Cleanup
      await page.evaluate(() => window.__TEST_HOST__?.dispose());
      await server.close();
    },
  };
}

// Augment Window type for Playwright evaluate calls
declare global {
  interface Window {
    __TEST_HOST__: {
      switchAccount(name: string): Promise<void>;
      setAccounts(names: string[]): Promise<void>;
      getSigningLog(): SigningLogEntry[];
      clearSigningLog(): void;
      getConnectionStatus(): string;
      getChainStatus(): string;
      dispose(): void;
    };
  }
}
