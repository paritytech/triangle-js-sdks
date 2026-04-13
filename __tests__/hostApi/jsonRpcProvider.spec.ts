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

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const receivedBySDK: any[] = [];

    container.handleFeatureSupported((params, { ok }) =>
      ok(params.tag === 'Chain' && params.value === WellKnownChain.polkadotRelay),
    );
    container.handleChainConnection(chain => {
      if (chain !== WellKnownChain.polkadotRelay) return null;

      return onMessage => {
        return {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          send(message: any) {
            const parsed = message;
            if (parsed.method === 'chainSpec_v1_chainName') {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              onMessage({ jsonrpc: '2.0', id: parsed.id, result: 'Polkadot' } as any);
            } else {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              onMessage({ jsonrpc: '2.0', id: parsed.id, result: null } as any);
            }
          },
          disconnect() {
            /* empty */
          },
        };
      };
    });

    const sdkConnection = provider(message => receivedBySDK.push(message));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    sdkConnection.send({ jsonrpc: '2.0', id: 1, method: 'chainSpec_v1_chainName', params: [] } as any);

    await delay(100);

    const response = receivedBySDK.find(m => m.id === 1);
    expect(response).toBeDefined();
    expect(response!.result).toBe('Polkadot');
  });

  it('should not send messages when feature is not supported', async () => {
    const { container, provider } = setup(WellKnownChain.polkadotRelay);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const receivedByProvider: any[] = [];

    // Feature returns false - chain not supported
    container.handleFeatureSupported((_, { ok }) => ok(false));
    container.handleChainConnection(chain => {
      if (chain !== WellKnownChain.polkadotRelay) return null;

      return onMessage => {
        return {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          send(message: any) {
            receivedByProvider.push(message);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            onMessage({ jsonrpc: '2.0', id: message.id, result: 'ok' } as any);
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

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    sdkConnection.send({ jsonrpc: '2.0', id: 1, method: 'chainSpec_v1_chainName', params: [] } as any);

    await delay(100);

    // Messages should not reach the provider when feature is not supported
    expect(receivedByProvider).toEqual([]);
  });

  it('should handle disconnect gracefully', async () => {
    const { container, provider } = setup(WellKnownChain.polkadotRelay);
    const disconnectFn = vi.fn();

    container.handleFeatureSupported((params, { ok }) =>
      ok(params.tag === 'Chain' && params.value === WellKnownChain.polkadotRelay),
    );
    container.handleChainConnection(chain => {
      if (chain !== WellKnownChain.polkadotRelay) return null;

      return onMessage => {
        return {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          send(message: any) {
            const parsed = message;
            if (parsed.method === 'chainHead_v1_follow') {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              onMessage({ jsonrpc: '2.0', id: parsed.id, result: 'sub_1' } as any);
            } else {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              onMessage({ jsonrpc: '2.0', id: parsed.id, result: null } as any);
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    sdkConnection.send({ jsonrpc: '2.0', id: 1, method: 'chainHead_v1_follow', params: [false] } as any);

    await delay(100);

    sdkConnection.disconnect();

    await delay(50);

    expect(disconnectFn).toHaveBeenCalled();
  });

  it('should route messages to correct chain provider', async () => {
    const { container, provider } = setup(WellKnownChain.polkadotRelay);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const receivedByPolkadot: any[] = [];

    container.handleFeatureSupported((params, { ok }) =>
      ok(params.tag === 'Chain' && params.value === WellKnownChain.polkadotRelay),
    );
    container.handleChainConnection(chain => {
      if (chain === WellKnownChain.polkadotRelay) {
        return onMessage => ({
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          send(message: any) {
            receivedByPolkadot.push(message);
            const parsed = message;
            if (parsed.method === 'chainSpec_v1_chainName') {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              onMessage({ jsonrpc: '2.0', id: parsed.id, result: 'Polkadot' } as any);
            } else {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              onMessage({ jsonrpc: '2.0', id: parsed.id, result: null } as any);
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

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    sdkConnection.send({ jsonrpc: '2.0', id: 1, method: 'chainSpec_v1_chainName', params: [] } as any);

    await delay(100);

    // Only Polkadot provider should receive the request
    expect(receivedByPolkadot.length).toBeGreaterThan(0);
    const receivedMethod = receivedByPolkadot[0]!.method;
    expect(receivedMethod).toBe('chainSpec_v1_chainName');
  });
});
