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
  it('should send messages', async () => {
    const { container, provider } = setup(WellKnownChain.polkadotRelay);

    const inputMessage = {
      jsonrpc: '2.0',
      id: '1',
      method: 'test_request',
      params: [],
    };

    const outputMessage = {
      jsonrpc: '2.0',
      id: '1',
      method: 'test_response',
      params: ['test'],
    };

    const receivedByProvider: string[] = [];
    const receivedBySDK: string[] = [];

    container.handleFeature((params, { ok }) =>
      ok(params.tag === 'Chain' && params.value === WellKnownChain.polkadotRelay),
    );
    container.handleChainConnection(chain => {
      if (chain !== WellKnownChain.polkadotRelay) return null;

      return onMessage => {
        return {
          send(message) {
            receivedByProvider.push(message);
            onMessage(JSON.stringify(outputMessage));
          },
          disconnect() {
            /* empty */
          },
        };
      };
    });

    const sdkConnection = provider(message => receivedBySDK.push(message));

    sdkConnection.send(JSON.stringify(inputMessage));

    await delay(50);

    expect(receivedByProvider).toEqual([JSON.stringify(inputMessage)]);
    expect(receivedBySDK).toEqual([JSON.stringify(outputMessage)]);
  });

  it('should not send messages when feature is not supported', async () => {
    const { container, provider } = setup(WellKnownChain.polkadotRelay);

    const inputMessage = {
      jsonrpc: '2.0',
      id: '1',
      method: 'test_request',
      params: [],
    };

    const receivedByProvider: string[] = [];

    // Feature returns false - chain not supported
    container.handleFeature((_, { ok }) => ok(false));
    container.handleChainConnection(chain => {
      if (chain !== WellKnownChain.polkadotRelay) return null;

      return onMessage => {
        return {
          send(message) {
            receivedByProvider.push(message);
            onMessage(JSON.stringify({ jsonrpc: '2.0', id: '1', result: 'ok' }));
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

    sdkConnection.send(JSON.stringify(inputMessage));

    await delay(50);

    // Messages should not reach the provider when feature is not supported
    expect(receivedByProvider).toEqual([]);
  });

  it('should handle disconnect gracefully', async () => {
    const { container, provider } = setup(WellKnownChain.polkadotRelay);
    const disconnectFn = vi.fn();

    container.handleFeature((params, { ok }) =>
      ok(params.tag === 'Chain' && params.value === WellKnownChain.polkadotRelay),
    );
    container.handleChainConnection(chain => {
      if (chain !== WellKnownChain.polkadotRelay) return null;

      return () => {
        return {
          send() {
            /* empty */
          },
          disconnect: disconnectFn,
        };
      };
    });

    const sdkConnection = provider(() => {
      /* ignore responses */
    });

    sdkConnection.disconnect();

    await delay(50);

    expect(disconnectFn).toHaveBeenCalled();
  });

  it('should not process messages for different chain', async () => {
    const differentChain = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef' as const;
    const { container, provider } = setup(WellKnownChain.polkadotRelay);

    const inputMessage = {
      jsonrpc: '2.0',
      id: '1',
      method: 'test_request',
      params: [],
    };

    const receivedByPolkadot: string[] = [];
    const receivedByOther: string[] = [];

    container.handleFeature((params, { ok }) =>
      ok(params.tag === 'Chain' && params.value === WellKnownChain.polkadotRelay),
    );
    // Only handle Polkadot chain
    container.handleChainConnection(chain => {
      if (chain === WellKnownChain.polkadotRelay) {
        return onMessage => {
          return {
            send(message) {
              receivedByPolkadot.push(message);
              onMessage(JSON.stringify({ jsonrpc: '2.0', id: '1', result: 'polkadot' }));
            },
            disconnect() {
              /* empty */
            },
          };
        };
      }

      // Handler for different chain should not receive messages
      if (chain === differentChain) {
        return onMessage => {
          return {
            send(message) {
              receivedByOther.push(message);
              onMessage(JSON.stringify({ jsonrpc: '2.0', id: '1', result: 'other' }));
            },
            disconnect() {
              /* empty */
            },
          };
        };
      }

      return null;
    });

    const sdkConnection = provider(() => {
      /* ignore */
    });

    sdkConnection.send(JSON.stringify(inputMessage));

    await delay(50);

    expect(receivedByPolkadot).toEqual([JSON.stringify(inputMessage)]);
    expect(receivedByOther).toEqual([]);
  });
});
