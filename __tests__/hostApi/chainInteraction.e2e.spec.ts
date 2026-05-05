/* eslint-disable @typescript-eslint/no-non-null-assertion,@typescript-eslint/no-explicit-any */

import { createTransport } from '@novasamatech/host-api';
import { createContainer } from '@novasamatech/host-container';
import { WellKnownChain, createPapiProvider } from '@novasamatech/product-sdk';

import type { JsonRpcMessage, JsonRpcProvider } from '@polkadot-api/json-rpc-provider';
import { describe, expect, it } from 'vitest';

import { delay } from './__mocks__/helpers.js';
import { createHostApiProviders } from './__mocks__/hostApiProviders.js';

const POLKADOT_RPC_URL = 'wss://rpc.polkadot.io';
const POLKADOT_GENESIS_HASH = WellKnownChain.polkadotRelay;
const SYSTEM_NUMBER_KEY = '0x26aa394eea5630e07c48ae0c9558cef702a5c1b19ab7a04f536c519aca4983ac';

function createWebSocketProvider(url: string): JsonRpcProvider {
  return onMessage => {
    const ws = new WebSocket(url);
    const pending: JsonRpcMessage[] = [];

    ws.addEventListener('open', () => {
      for (const msg of pending) ws.send(JSON.stringify(msg));
      pending.length = 0;
    });

    ws.addEventListener('message', event => onMessage(JSON.parse(event.data.toString())));

    return {
      send(message) {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify(message));
        } else {
          pending.push(message);
        }
      },
      disconnect() {
        ws.close();
      },
    };
  };
}

/**
 * Polls for a message matching `predicate` in `messages`.
 * Returns the matching message or undefined if not found within the timeout.
 */
async function pollForMessage(
  messages: JsonRpcMessage[],
  predicate: (parsed: Record<string, unknown>) => boolean,
  maxIterations = 150,
  interval = 200,
): Promise<JsonRpcMessage | undefined> {
  for (let i = 0; i < maxIterations; i++) {
    const found = messages.find(m => {
      try {
        return predicate(m);
      } catch {
        return false;
      }
    });
    if (found) return found;
    await delay(interval);
  }
  return undefined;
}

type TestSetup = {
  sdkConnection: ReturnType<JsonRpcProvider>;
  receivedMessages: JsonRpcMessage[];
  cleanup: () => Promise<void>;
};

function createTestSetup(): TestSetup {
  const providers = createHostApiProviders();
  const container = createContainer(providers.host);
  const sdkTransport = createTransport(providers.sdk);
  const provider = createPapiProvider(POLKADOT_GENESIS_HASH, undefined, { transport: sdkTransport });

  container.handleFeatureSupported((params, { ok }) =>
    ok(params.tag === 'Chain' && params.value === POLKADOT_GENESIS_HASH),
  );

  const chainDispose = container.handleChainConnection(chain => {
    if (chain !== POLKADOT_GENESIS_HASH) return null;
    return createWebSocketProvider(POLKADOT_RPC_URL);
  });

  const receivedMessages: JsonRpcMessage[] = [];
  const sdkConnection = provider(msg => receivedMessages.push(msg));

  const cleanup = async () => {
    sdkConnection.disconnect();
    chainDispose();
    container.dispose();
    await delay(200);
  };

  return { sdkConnection, receivedMessages, cleanup };
}

type ChainHeadSetup = TestSetup & {
  followSubId: string;
  initialBlockHash: string;
};

// Sets up a follow subscription (id=1) and waits for the initialized event.
// Tests using this setup should start their own request IDs from 2.
async function createChainHeadSetup(): Promise<ChainHeadSetup> {
  const setup = createTestSetup();

  setup.sdkConnection.send({ jsonrpc: '2.0', id: 1, method: 'chainHead_v1_follow', params: [false] });

  const followResp = await pollForMessage(setup.receivedMessages, p => p.id === 1 && p.result !== undefined);
  if (!followResp) throw new Error('Failed to start follow subscription');
  const followSubId = 'result' in followResp ? (followResp.result as string) : '';

  const initEvent = await pollForMessage(
    setup.receivedMessages,
    p => (p as any).method === 'chainHead_v1_followEvent' && (p as any).params?.result?.event === 'initialized',
  );
  if (!initEvent) throw new Error('Did not receive initialized event');

  const initialBlockHash = (initEvent as any).params.result.finalizedBlockHashes[0] as string;

  return { ...setup, followSubId, initialBlockHash };
}

// E2E tests against a real Polkadot node.
// Each test opens its own connection to avoid shared state causing flakiness.
// Retries are enabled because public endpoints may occasionally be slow or temporarily unavailable.
describe('E2E: Chain Interaction against real Polkadot node', { retry: 2, timeout: 30_000 }, () => {
  describe('chainSpec methods', () => {
    it('chainSpec_v1_genesisHash — should return the Polkadot genesis hash', async () => {
      const { sdkConnection, receivedMessages, cleanup } = createTestSetup();
      try {
        sdkConnection.send({ jsonrpc: '2.0', id: 1, method: 'chainSpec_v1_genesisHash', params: [] });

        const response = await pollForMessage(receivedMessages, p => p.id === 1 && p.result !== undefined);
        expect(response).toBeDefined();

        expect((response! as any).result).toBe(POLKADOT_GENESIS_HASH);
      } finally {
        await cleanup();
      }
    });

    it('chainSpec_v1_chainName — should return a non-empty string', async () => {
      const { sdkConnection, receivedMessages, cleanup } = createTestSetup();
      try {
        sdkConnection.send({ jsonrpc: '2.0', id: 1, method: 'chainSpec_v1_chainName', params: [] });

        const response = await pollForMessage(receivedMessages, p => p.id === 1 && p.result !== undefined);
        expect(response).toBeDefined();

        const parsed = response as any;
        expect(typeof parsed.result).toBe('string');
        expect(parsed.result.length).toBeGreaterThan(0);
      } finally {
        await cleanup();
      }
    });

    it('chainSpec_v1_properties — should return object with tokenSymbol DOT and tokenDecimals 10', async () => {
      const { sdkConnection, receivedMessages, cleanup } = createTestSetup();
      try {
        sdkConnection.send({ jsonrpc: '2.0', id: 1, method: 'chainSpec_v1_properties', params: [] });

        const response = await pollForMessage(receivedMessages, p => p.id === 1 && p.result !== undefined);
        expect(response).toBeDefined();

        const parsed = response as any;
        const props = parsed.result;
        expect(props).toBeDefined();
        expect(props.tokenSymbol).toBe('DOT');
        expect(props.tokenDecimals).toBe(10);
      } finally {
        await cleanup();
      }
    });
  });

  describe('chainHead methods', () => {
    it('chainHead_v1_follow — should subscribe and receive initialized event with finalized block hashes', async () => {
      const { sdkConnection, receivedMessages, cleanup } = createTestSetup();
      try {
        sdkConnection.send({ jsonrpc: '2.0', id: 1, method: 'chainHead_v1_follow', params: [false] });

        const followResp = await pollForMessage(receivedMessages, p => p.id === 1 && p.result !== undefined);
        expect(followResp).toBeDefined();

        const followSubId = (followResp as any).result;
        expect(typeof followSubId).toBe('string');

        const initEvent = await pollForMessage(
          receivedMessages,
          p => (p as any).method === 'chainHead_v1_followEvent' && (p as any).params?.result?.event === 'initialized',
        );

        expect(initEvent).toBeDefined();
        const parsedInit = initEvent as any;
        expect(parsedInit.params.result.event).toBe('initialized');
        expect(Array.isArray(parsedInit.params.result.finalizedBlockHashes)).toBe(true);
        expect(parsedInit.params.result.finalizedBlockHashes.length).toBeGreaterThan(0);

        for (const hash of parsedInit.params.result.finalizedBlockHashes) {
          expect(hash).toMatch(/^0x[0-9a-fA-F]+$/);
        }
      } finally {
        await cleanup();
      }
    });

    it('chainHead_v1_header — should get a block header as hex string starting with 0x', async () => {
      const { sdkConnection, receivedMessages, followSubId, initialBlockHash, cleanup } = await createChainHeadSetup();
      try {
        sdkConnection.send({
          jsonrpc: '2.0',
          id: 2,
          method: 'chainHead_v1_header',
          params: [followSubId, initialBlockHash],
        });

        const response = await pollForMessage(
          receivedMessages,
          p => p.id === 2 && (p.result !== undefined || p.error !== undefined),
        );

        expect(response).toBeDefined();
        const parsed = response as any;
        expect(parsed.result).toBeDefined();
        expect(typeof parsed.result).toBe('string');
        expect(parsed.result).toMatch(/^0x/);
      } finally {
        await cleanup();
      }
    });

    it('chainHead_v1_storage — should read System.Number storage value', async () => {
      const { sdkConnection, receivedMessages, followSubId, initialBlockHash, cleanup } = await createChainHeadSetup();
      try {
        sdkConnection.send({
          jsonrpc: '2.0',
          id: 2,
          method: 'chainHead_v1_storage',
          params: [followSubId, initialBlockHash, [{ key: SYSTEM_NUMBER_KEY, type: 'value' }], null],
        });

        const storageResp = await pollForMessage(
          receivedMessages,
          p => p.id === 2 && (p.result !== undefined || p.error !== undefined),
        );

        expect(storageResp).toBeDefined();
        const parsedResp = storageResp as any;
        expect(parsedResp.result).toBeDefined();
        expect(parsedResp.result.result).toBe('started');
        expect(parsedResp.result.operationId).toBeDefined();

        const operationId = parsedResp.result.operationId;

        const storageItemsEvent = await pollForMessage(
          receivedMessages,
          p =>
            (p as any).method === 'chainHead_v1_followEvent' &&
            (p as any).params?.result?.event === 'operationStorageItems' &&
            (p as any).params?.result?.operationId === operationId,
        );

        expect(storageItemsEvent).toBeDefined();
        const parsedItems = storageItemsEvent as any;
        expect(parsedItems.params.result.items.length).toBeGreaterThan(0);
        expect(parsedItems.params.result.items[0].key).toBe(SYSTEM_NUMBER_KEY);
        expect(parsedItems.params.result.items[0].value).toMatch(/^0x/);

        const storageDoneEvent = await pollForMessage(
          receivedMessages,
          p =>
            (p as any).method === 'chainHead_v1_followEvent' &&
            (p as any).params?.result?.event === 'operationStorageDone' &&
            (p as any).params?.result?.operationId === operationId,
        );

        expect(storageDoneEvent).toBeDefined();
      } finally {
        await cleanup();
      }
    });

    it('chainHead_v1_unpin — should unpin a block without error', async () => {
      const { sdkConnection, receivedMessages, followSubId, initialBlockHash, cleanup } = await createChainHeadSetup();
      try {
        sdkConnection.send({
          jsonrpc: '2.0',
          id: 2,
          method: 'chainHead_v1_unpin',
          params: [followSubId, [initialBlockHash]],
        });

        const response = await pollForMessage(
          receivedMessages,
          p => p.id === 2 && (p.result !== undefined || p.error !== undefined),
        );

        expect(response).toBeDefined();
        const parsed = response as any;
        expect(parsed.error).toBeUndefined();
        expect(parsed.result).toBe(null);
      } finally {
        await cleanup();
      }
    });
  });
});
