/**
 * Browser-side host runtime — bundled by esbuild into a single IIFE.
 *
 * Reads config from window.__TEST_HOST_CONFIG__, initialises crypto,
 * derives dev keypairs, creates a Spektr host-container for the product
 * iframe, and registers all required handlers (accounts, signing,
 * chain RPC, localStorage).
 *
 * Exposes window.__TEST_HOST__ for Playwright control.
 */

import { SigningErr } from '@novasamatech/host-api';
import type { Container } from '@novasamatech/host-container';
import { createContainer, createIframeProvider } from '@novasamatech/host-container';
import { Keyring } from '@polkadot/keyring';
import type { KeyringPair } from '@polkadot/keyring/types';
import { TypeRegistry } from '@polkadot/types';
import { u8aToHex } from '@polkadot/util';
import { cryptoWaitReady } from '@polkadot/util-crypto';
import { ResultAsync } from 'neverthrow';
import { getWsProvider } from 'polkadot-api/ws-provider';

// ── Types ──────────────────────────────────────────────────────────

interface AccountConfig {
  name: string;
  uri: string;
}

interface ChainRuntimeConfig {
  genesisHash: string;
  rpcUrl: string;
  name: string;
}

interface HostConfig {
  productUrl: string;
  accounts: AccountConfig[];
  chain: ChainRuntimeConfig;
}

interface SigningLogEntry {
  type: 'payload' | 'raw';
  payload: unknown;
  timestamp: number;
}

interface TestHostAPI {
  switchAccount(name: string): Promise<void>;
  setAccounts(names: string[]): Promise<void>;
  getSigningLog(): SigningLogEntry[];
  clearSigningLog(): void;
  getConnectionStatus(): string;
  getChainStatus(): string;
  dispose(): void;
}

// ── Globals ────────────────────────────────────────────────────────

declare global {
  interface Window {
    __TEST_HOST_CONFIG__: HostConfig;
    __TEST_HOST__: TestHostAPI;
  }
}

// ── State ──────────────────────────────────────────────────────────

const signingLog: SigningLogEntry[] = [];
let connectionStatus = 'connecting';
let chainStatus = 'connecting';
let currentContainer: Container | null = null;
let keyring: Keyring;
const pairsByUri = new Map<string, KeyringPair>();

// ── Helpers ────────────────────────────────────────────────────────

/** Normalize a genesis hash for comparison — handles different types and casing */
function normalizeHash(value: unknown): string {
  const str = String(value).toLowerCase().trim();
  return str.startsWith('0x') ? str : `0x${str}`;
}

function getPair(uri: string): KeyringPair {
  let pair = pairsByUri.get(uri);
  if (!pair) {
    pair = keyring.addFromUri(uri);
    pairsByUri.set(uri, pair);
  }
  return pair;
}

function getPairByAddress(address: string): KeyringPair | undefined {
  for (const pair of pairsByUri.values()) {
    if (pair.address === address) return pair;
  }
  // Try matching by public key hex (product-sdk sends 0x + hex(publicKey))
  const normalized = address.toLowerCase();
  for (const pair of pairsByUri.values()) {
    if (u8aToHex(pair.publicKey).toLowerCase() === normalized) return pair;
  }
  // Try matching by SS58 re-encoding (address might be in different SS58 format)
  for (const pair of pairsByUri.values()) {
    try {
      if (keyring.encodeAddress(pair.publicKey) === address) return pair;
    } catch {
      // ignore decoding errors
    }
  }
  return undefined;
}

// ── Container setup ────────────────────────────────────────────────

function setupContainer(
  iframe: HTMLIFrameElement,
  productUrl: string,
  accounts: AccountConfig[],
  chainConfig: ChainRuntimeConfig,
): Container {
  const provider = createIframeProvider({ iframe, url: productUrl });
  const container = createContainer(provider);

  // Derive keypairs for all requested accounts
  const pairs = accounts.map(acc => {
    const pair = getPair(acc.uri);
    return { pair, name: acc.name };
  });

  // ── Feature support ──────────────────────────────────────────

  container.handleFeatureSupported((params, { ok }) => {
    if (params.tag === 'Chain') {
      const requested = normalizeHash(params.value);
      const configured = normalizeHash(chainConfig.genesisHash);
      const supported = requested === configured;
      if (!supported) {
        console.warn(
          `[test-host] Chain feature check MISMATCH:\n` +
            `  requested: ${String(params.value)} (type: ${typeof params.value})\n` +
            `  configured: ${chainConfig.genesisHash}\n` +
            `  normalized: ${requested} vs ${configured}`,
        );
      }
      return ok(supported);
    }
    return ok(false);
  });

  // ── Chain connection ─────────────────────────────────────────

  chainStatus = 'connecting';
  const chainProvider = getWsProvider(chainConfig.rpcUrl);
  chainStatus = 'connected';

  container.handleChainConnection(requestedGenesisHash => {
    const requested = normalizeHash(requestedGenesisHash);
    const configured = normalizeHash(chainConfig.genesisHash);
    if (requested === configured) {
      console.log('[test-host] Chain connection established for', chainConfig.name);
      return chainProvider;
    }
    console.warn('[test-host] Unsupported chain requested:', requestedGenesisHash);
    return null;
  });

  // ── Accounts ─────────────────────────────────────────────────

  container.handleGetNonProductAccounts((_, { ok }) => {
    return ok(
      pairs.map(({ pair, name }) => ({
        publicKey: pair.publicKey,
        name,
      })),
    );
  });

  container.handleAccountConnectionStatusSubscribe((_, send) => {
    send(pairs.length > 0 ? 'connected' : 'disconnected');
    // No dynamic updates — static test accounts
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    return () => {};
  });

  // ── Sign payload (extrinsic) ─────────────────────────────────

  container.handleSignPayload((params, { ok: _ok, err }) => {
    const pair = getPairByAddress(params.address);
    if (!pair) {
      return err(new SigningErr.Unknown({ reason: `No keypair for address: ${params.address}` }));
    }

    signingLog.push({ type: 'payload', payload: params, timestamp: Date.now() });

    return ResultAsync.fromPromise(
      (async () => {
        const registry = new TypeRegistry();
        registry.setSignedExtensions(params.signedExtensions);
        const extrinsicPayload = registry.createType('ExtrinsicPayload', params, { version: params.version });

        // extrinsicPayload.sign() returns { signature: HexString } — already hex-encoded.
        // Do NOT apply u8aToHex() again (that would double-encode).
        const { signature } = extrinsicPayload.sign(pair);
        return {
          signature: signature as `0x${string}`,
          signedTransaction: undefined,
        };
      })(),
      e => {
        const msg = e instanceof Error ? e.message : String(e);
        console.error('[test-host] Sign error:', msg);
        return new SigningErr.Unknown({ reason: msg });
      },
    );
  });

  // ── Sign raw ─────────────────────────────────────────────────

  container.handleSignRaw((params, { ok, err }) => {
    const pair = getPairByAddress(params.address);
    if (!pair) {
      return err(new SigningErr.Unknown({ reason: `No keypair for address: ${params.address}` }));
    }

    signingLog.push({ type: 'raw', payload: params, timestamp: Date.now() });

    let dataToSign: Uint8Array;
    if (params.data.tag === 'Bytes') {
      dataToSign = params.data.value;
    } else {
      // Payload string — encode as UTF-8 bytes
      dataToSign = new TextEncoder().encode(params.data.value);
    }

    const signature = pair.sign(dataToSign);
    return ok({
      signature: u8aToHex(signature) as `0x${string}`,
      signedTransaction: undefined,
    });
  });

  // ── Local storage (scoped per test) ──────────────────────────

  container.handleLocalStorageRead((key, { ok }) => {
    const storageKey = `test-host:${key}`;
    const raw = localStorage.getItem(storageKey);
    return ok(raw !== null ? new TextEncoder().encode(raw) : undefined);
  });

  container.handleLocalStorageWrite(([key, value], { ok }) => {
    const storageKey = `test-host:${key}`;
    localStorage.setItem(storageKey, new TextDecoder().decode(value));
    return ok(undefined);
  });

  container.handleLocalStorageClear((key, { ok }) => {
    const storageKey = `test-host:${key}`;
    localStorage.removeItem(storageKey);
    return ok(undefined);
  });

  // ── Connection status ────────────────────────────────────────

  container.subscribeProductConnectionStatus(status => {
    connectionStatus = status;
  });

  return container;
}

// ── Init ───────────────────────────────────────────────────────────

async function init(): Promise<void> {
  const config = window.__TEST_HOST_CONFIG__;
  if (!config) {
    console.error('[test-host] No __TEST_HOST_CONFIG__ found');
    return;
  }

  // Wait for WASM crypto (sr25519 signing)
  await cryptoWaitReady();

  keyring = new Keyring({ type: 'sr25519', ss58Format: 42 });

  const iframe = document.getElementById('product-frame') as HTMLIFrameElement;
  iframe.src = config.productUrl;

  currentContainer = setupContainer(iframe, config.productUrl, config.accounts, config.chain);

  // ── Control API for Playwright ─────────────────────────────

  window.__TEST_HOST__ = {
    async switchAccount(name: string) {
      await this.setAccounts([name]);
    },

    async setAccounts(names: string[]) {
      const accounts = names.map(n => ({
        name: n.charAt(0).toUpperCase() + n.slice(1).toLowerCase(),
        uri: `//${n.charAt(0).toUpperCase()}${n.slice(1).toLowerCase()}`,
      }));

      // Dispose current container
      if (currentContainer) {
        currentContainer.dispose();
        currentContainer = null;
      }

      // Recreate container with new accounts (triggers iframe reload)
      const iframe = document.getElementById('product-frame') as HTMLIFrameElement;
      iframe.src = config.productUrl;

      currentContainer = setupContainer(iframe, config.productUrl, accounts, config.chain);
    },

    getSigningLog() {
      return [...signingLog];
    },

    clearSigningLog() {
      signingLog.length = 0;
    },

    getConnectionStatus() {
      return connectionStatus;
    },

    getChainStatus() {
      return chainStatus;
    },

    dispose() {
      if (currentContainer) {
        currentContainer.dispose();
        currentContainer = null;
      }
    },
  };

  console.log(
    '[test-host] Initialized:',
    '\n  chain:',
    config.chain.name,
    '(' + config.chain.genesisHash.slice(0, 18) + '...)',
    '\n  rpc:',
    config.chain.rpcUrl,
    '\n  accounts:',
    config.accounts.map(a => a.name).join(', '),
  );
}

init().catch(err => {
  console.error('[test-host] Init failed:', err);
});
