import type { HexString } from '@novasamatech/host-api';
import { createTransport } from '@novasamatech/host-api';
import { createContainer } from '@novasamatech/host-container';
import { WellKnownChain, createPapiProvider } from '@novasamatech/product-sdk';

import { describe, expect, it, vi } from 'vitest';

import { createHostApiProviders } from './__mocks__/hostApiProviders.js';

function delay(ttl: number) {
  return new Promise(resolve => setTimeout(resolve, ttl));
}

function setup(chainId: HexString) {
  const providers = createHostApiProviders();
  const container = createContainer(providers.host);
  const sdkTransport = createTransport(providers.sdk);

  const provider = createPapiProvider(chainId, undefined, { transport: sdkTransport });

  return { container, provider };
}

describe('Host API: JSON RPC provider', () => {
  it('should send and receive messages through typed chain interaction', async () => {
    const { container, provider } = setup(WellKnownChain.polkadotRelay);

    const receivedBySDK: string[] = [];

    container.handleFeatureSupported((params, { ok }) =>
      ok(params.tag === 'Chain' && params.value === WellKnownChain.polkadotRelay),
    );
    container.handleChainInteraction(chain => {
      if (chain !== WellKnownChain.polkadotRelay) return null;

      return onMessage => {
        return {
          send(message: string) {
            const parsed = JSON.parse(message);
            if (parsed.method === 'chainSpec_v1_chainName') {
              onMessage(JSON.stringify({ jsonrpc: '2.0', id: parsed.id, result: 'Polkadot' }));
            } else {
              onMessage(JSON.stringify({ jsonrpc: '2.0', id: parsed.id, result: null }));
            }
          },
          disconnect() {
            /* empty */
          },
        };
      };
    });

    const sdkConnection = provider(message => receivedBySDK.push(message));

    sdkConnection.send(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'chainSpec_v1_chainName',
        params: [],
      }),
    );

    await delay(100);

    const response = receivedBySDK.find(m => JSON.parse(m).id === 1);
    expect(response).toBeDefined();
    expect(JSON.parse(response!).result).toBe('Polkadot');
  });

  it('should not send messages when feature is not supported', async () => {
    const { container, provider } = setup(WellKnownChain.polkadotRelay);

    const receivedByProvider: string[] = [];

    // Feature returns false - chain not supported
    container.handleFeatureSupported((_, { ok }) => ok(false));
    container.handleChainInteraction(chain => {
      if (chain !== WellKnownChain.polkadotRelay) return null;

      return onMessage => {
        return {
          send(message: string) {
            receivedByProvider.push(message);
            onMessage(JSON.stringify({ jsonrpc: '2.0', id: JSON.parse(message).id, result: 'ok' }));
          },
          disconnect() {
            /* empty */
          },
        };
      };
    });

    const sdkConnection = provider(() => {
      /* ignore responses */
    });

    sdkConnection.send(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'chainSpec_v1_chainName',
        params: [],
      }),
    );

    await delay(50);

    // Messages should not reach the provider when feature is not supported
    expect(receivedByProvider).toEqual([]);
  });

  it('should handle disconnect gracefully', async () => {
    const { container, provider } = setup(WellKnownChain.polkadotRelay);
    const disconnectFn = vi.fn();

    container.handleFeatureSupported((params, { ok }) =>
      ok(params.tag === 'Chain' && params.value === WellKnownChain.polkadotRelay),
    );
    container.handleChainInteraction(chain => {
      if (chain !== WellKnownChain.polkadotRelay) return null;

      return onMessage => {
        return {
          send(message: string) {
            const parsed = JSON.parse(message);
            if (parsed.method === 'chainHead_v1_follow') {
              onMessage(JSON.stringify({ jsonrpc: '2.0', id: parsed.id, result: 'sub_1' }));
            } else {
              onMessage(JSON.stringify({ jsonrpc: '2.0', id: parsed.id, result: null }));
            }
          },
          disconnect: disconnectFn,
        };
      };
    });

    const sdkConnection = provider(() => {
      /* ignore responses */
    });

    // Establish a connection first via follow
    sdkConnection.send(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'chainHead_v1_follow', params: [false] }));

    await delay(50);

    sdkConnection.disconnect();

    await delay(50);

    expect(disconnectFn).toHaveBeenCalled();
  });

  it('should route messages to correct chain provider', async () => {
    const { container, provider } = setup(WellKnownChain.polkadotRelay);

    const receivedByPolkadot: string[] = [];

    container.handleFeatureSupported((params, { ok }) =>
      ok(params.tag === 'Chain' && params.value === WellKnownChain.polkadotRelay),
    );
    container.handleChainInteraction(chain => {
      if (chain === WellKnownChain.polkadotRelay) {
        return onMessage => ({
          send(message: string) {
            receivedByPolkadot.push(message);
            const parsed = JSON.parse(message);
            if (parsed.method === 'chainSpec_v1_chainName') {
              onMessage(JSON.stringify({ jsonrpc: '2.0', id: parsed.id, result: 'Polkadot' }));
            } else {
              onMessage(JSON.stringify({ jsonrpc: '2.0', id: parsed.id, result: null }));
            }
          },
          disconnect() {
            /* empty */
          },
        });
      }

      return null;
    });

    const sdkConnection = provider(() => {
      /* ignore */
    });

    sdkConnection.send(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'chainSpec_v1_chainName',
        params: [],
      }),
    );

    await delay(100);

    // Only Polkadot provider should receive the request
    expect(receivedByPolkadot.length).toBeGreaterThan(0);
    const receivedMethod = JSON.parse(receivedByPolkadot[0]!).method;
    expect(receivedMethod).toBe('chainSpec_v1_chainName');
  });
});
