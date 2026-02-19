import type { HexString } from '@novasamatech/host-api';
import { createTransport } from '@novasamatech/host-api';
import { createContainer } from '@novasamatech/host-container';
import { WellKnownChain, createPapiProvider } from '@novasamatech/product-sdk';

import type { JsonRpcProvider } from '@polkadot-api/json-rpc-provider';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';

import { createHostApiProviders } from './__mocks__/hostApiProviders.js';

const POLKADOT_RPC_URL = 'wss://rpc.polkadot.io';
const POLKADOT_GENESIS_HASH = WellKnownChain.polkadotRelay;
const SYSTEM_NUMBER_KEY = '0x26aa394eea5630e07c48ae0c9558cef702a5c1b19ab7a04f536c519aca4983ac';

function delay(ttl: number) {
  return new Promise(resolve => setTimeout(resolve, ttl));
}

function createWebSocketProvider(url: string): JsonRpcProvider {
  return onMessage => {
    const ws = new WebSocket(url);
    const pending: string[] = [];

    ws.on('open', () => {
      for (const msg of pending) ws.send(msg);
      pending.length = 0;
    });

    ws.on('message', (data: Buffer) => onMessage(data.toString()));

    return {
      send(message: string) {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(message);
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
  messages: string[],
  predicate: (parsed: Record<string, unknown>) => boolean,
  maxIterations = 150,
  interval = 200,
): Promise<string | undefined> {
  for (let i = 0; i < maxIterations; i++) {
    const found = messages.find(m => {
      try {
        return predicate(JSON.parse(m));
      } catch {
        return false;
      }
    });
    if (found) return found;
    await delay(interval);
  }
  return undefined;
}

// E2E tests against a real Polkadot node.
// Uses a single shared WebSocket connection to avoid rate-limiting from the public RPC endpoint.
// Retries are enabled because public endpoints may occasionally be slow or temporarily unavailable.
describe('E2E: Chain Interaction against real Polkadot node', { retry: 2, timeout: 30_000 }, () => {
  let container: ReturnType<typeof createContainer>;
  let sdkConnection: { send: (msg: string) => void; disconnect: () => void };
  let chainDispose: VoidFunction;
  const receivedMessages: string[] = [];
  let nextId = 1;

  // chainHead state established during setup
  let followSubId: string;
  let initialBlockHash: string;

  beforeAll(async () => {
    const providers = createHostApiProviders();
    container = createContainer(providers.host);
    const sdkTransport = createTransport(providers.sdk);
    const provider = createPapiProvider(POLKADOT_GENESIS_HASH as HexString, undefined, {
      transport: sdkTransport,
    });

    container.handleFeatureSupported((params, { ok }) =>
      ok(params.tag === 'Chain' && params.value === POLKADOT_GENESIS_HASH),
    );

    chainDispose = container.handleChainConnection(chain => {
      if (chain !== POLKADOT_GENESIS_HASH) return null;
      return createWebSocketProvider(POLKADOT_RPC_URL);
    });

    sdkConnection = provider(msg => receivedMessages.push(msg));

    // Start follow subscription (needed for chainHead tests and also warms up the connection)
    const followId = nextId++;
    sdkConnection.send(
      JSON.stringify({ jsonrpc: '2.0', id: followId, method: 'chainHead_v1_follow', params: [false] }),
    );

    // Wait for follow response
    const followResp = await pollForMessage(receivedMessages, p => p.id === followId && p.result !== undefined);
    if (!followResp) throw new Error('Failed to start follow subscription');
    followSubId = JSON.parse(followResp).result;

    // Wait for initialized event to get a block hash
    const initEvent = await pollForMessage(
      receivedMessages,
      p => (p as any).method === 'chainHead_v1_followEvent' && (p as any).params?.result?.event === 'initialized',
    );
    if (!initEvent) throw new Error('Did not receive initialized event');

    const parsedInit = JSON.parse(initEvent);
    initialBlockHash = parsedInit.params.result.finalizedBlockHashes[0];
  }, 60_000);

  afterAll(async () => {
    sdkConnection?.disconnect();
    chainDispose?.();
    container?.dispose();
    await delay(200);
  });

  describe('chainSpec methods', () => {
    it('chainSpec_v1_genesisHash — should return the Polkadot genesis hash', async () => {
      const id = nextId++;
      sdkConnection.send(JSON.stringify({ jsonrpc: '2.0', id, method: 'chainSpec_v1_genesisHash', params: [] }));

      const response = await pollForMessage(receivedMessages, p => p.id === id && p.result !== undefined);
      expect(response).toBeDefined();

      const parsed = JSON.parse(response!);
      expect(parsed.result).toBe(POLKADOT_GENESIS_HASH);
    });

    it('chainSpec_v1_chainName — should return a non-empty string', async () => {
      const id = nextId++;
      sdkConnection.send(JSON.stringify({ jsonrpc: '2.0', id, method: 'chainSpec_v1_chainName', params: [] }));

      const response = await pollForMessage(receivedMessages, p => p.id === id && p.result !== undefined);
      expect(response).toBeDefined();

      const parsed = JSON.parse(response!);
      expect(typeof parsed.result).toBe('string');
      expect(parsed.result.length).toBeGreaterThan(0);
    });

    it('chainSpec_v1_properties — should return object with tokenSymbol DOT and tokenDecimals 10', async () => {
      const id = nextId++;
      sdkConnection.send(JSON.stringify({ jsonrpc: '2.0', id, method: 'chainSpec_v1_properties', params: [] }));

      const response = await pollForMessage(receivedMessages, p => p.id === id && p.result !== undefined);
      expect(response).toBeDefined();

      const parsed = JSON.parse(response!);
      const props = parsed.result;
      expect(props).toBeDefined();
      expect(props.tokenSymbol).toBe('DOT');
      expect(props.tokenDecimals).toBe(10);
    });
  });

  describe('chainHead methods', () => {
    it('chainHead_v1_follow — should subscribe and receive initialized event with finalized block hashes', () => {
      // The follow subscription was established in beforeAll; verify the data
      expect(followSubId).toBeDefined();
      expect(typeof followSubId).toBe('string');

      // Find the initialized event in received messages
      const initEvent = receivedMessages.find(m => {
        const p = JSON.parse(m);
        return p.method === 'chainHead_v1_followEvent' && p.params?.result?.event === 'initialized';
      });

      expect(initEvent).toBeDefined();
      const parsedInit = JSON.parse(initEvent!);
      expect(parsedInit.params.result.event).toBe('initialized');
      expect(Array.isArray(parsedInit.params.result.finalizedBlockHashes)).toBe(true);
      expect(parsedInit.params.result.finalizedBlockHashes.length).toBeGreaterThan(0);

      // Verify the block hashes start with 0x
      for (const hash of parsedInit.params.result.finalizedBlockHashes) {
        expect(hash).toMatch(/^0x[0-9a-fA-F]+$/);
      }
    });

    it('chainHead_v1_header — should get a block header as hex string starting with 0x', async () => {
      const id = nextId++;
      sdkConnection.send(
        JSON.stringify({
          jsonrpc: '2.0',
          id,
          method: 'chainHead_v1_header',
          params: [followSubId, initialBlockHash],
        }),
      );

      const response = await pollForMessage(
        receivedMessages,
        p => p.id === id && (p.result !== undefined || p.error !== undefined),
      );

      expect(response).toBeDefined();
      const parsed = JSON.parse(response!);
      expect(parsed.result).toBeDefined();
      expect(typeof parsed.result).toBe('string');
      expect(parsed.result).toMatch(/^0x/);
    });

    it('chainHead_v1_storage — should read System.Number storage value', async () => {
      const id = nextId++;
      sdkConnection.send(
        JSON.stringify({
          jsonrpc: '2.0',
          id,
          method: 'chainHead_v1_storage',
          params: [followSubId, initialBlockHash, [{ key: SYSTEM_NUMBER_KEY, type: 'value' }], null],
        }),
      );

      // Wait for storage operation started response
      const storageResp = await pollForMessage(
        receivedMessages,
        p => p.id === id && (p.result !== undefined || p.error !== undefined),
      );

      expect(storageResp).toBeDefined();
      const parsedResp = JSON.parse(storageResp!);
      expect(parsedResp.result).toBeDefined();
      expect(parsedResp.result.result).toBe('started');
      expect(parsedResp.result.operationId).toBeDefined();

      const operationId = parsedResp.result.operationId;

      // Wait for operationStorageItems event
      const storageItemsEvent = await pollForMessage(
        receivedMessages,
        p =>
          (p as any).method === 'chainHead_v1_followEvent' &&
          (p as any).params?.result?.event === 'operationStorageItems' &&
          (p as any).params?.result?.operationId === operationId,
      );

      expect(storageItemsEvent).toBeDefined();
      const parsedItems = JSON.parse(storageItemsEvent!);
      expect(parsedItems.params.result.items.length).toBeGreaterThan(0);
      expect(parsedItems.params.result.items[0].key).toBe(SYSTEM_NUMBER_KEY);
      // The value should be a hex-encoded block number
      expect(parsedItems.params.result.items[0].value).toMatch(/^0x/);

      // Wait for operationStorageDone event
      const storageDoneEvent = await pollForMessage(
        receivedMessages,
        p =>
          (p as any).method === 'chainHead_v1_followEvent' &&
          (p as any).params?.result?.event === 'operationStorageDone' &&
          (p as any).params?.result?.operationId === operationId,
      );

      expect(storageDoneEvent).toBeDefined();
    });

    it('chainHead_v1_unpin — should unpin a block without error', async () => {
      const id = nextId++;
      sdkConnection.send(
        JSON.stringify({
          jsonrpc: '2.0',
          id,
          method: 'chainHead_v1_unpin',
          params: [followSubId, [initialBlockHash]],
        }),
      );

      const response = await pollForMessage(
        receivedMessages,
        p => p.id === id && (p.result !== undefined || p.error !== undefined),
      );

      expect(response).toBeDefined();
      const parsed = JSON.parse(response!);
      // Unpin should succeed: result is null and no error
      expect(parsed.error).toBeUndefined();
      expect(parsed.result).toBe(null);
    });
  });
});
