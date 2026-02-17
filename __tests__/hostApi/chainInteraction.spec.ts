import type { HexString } from '@novasamatech/host-api';
import { createHostApi, createTransport, enumValue } from '@novasamatech/host-api';
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

describe('Host API: Chain Interaction', () => {
  describe('chainHead follow subscription', () => {
    it('should establish follow subscription and receive initialized event', async () => {
      const { container, provider } = setup(WellKnownChain.polkadotRelay);
      const receivedMessages: string[] = [];
      const followFn = vi.fn();

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
                followFn(parsed.params[0]);
                // Respond with subscription ID
                onMessage(JSON.stringify({ jsonrpc: '2.0', id: parsed.id, result: 'chain_sub_1' }));

                // Send initialized event after a tick
                setTimeout(() => {
                  onMessage(
                    JSON.stringify({
                      jsonrpc: '2.0',
                      method: 'chainHead_v1_followEvent',
                      params: {
                        subscription: 'chain_sub_1',
                        result: {
                          event: 'initialized',
                          finalizedBlockHashes: ['0xaabb0011'],
                          finalizedBlockRuntime: null,
                        },
                      },
                    }),
                  );
                }, 10);
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

      const sdkConnection = provider(msg => receivedMessages.push(msg));

      // PAPI sends chainHead_v1_follow
      sdkConnection.send(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'chainHead_v1_follow',
          params: [true],
        }),
      );

      await delay(100);

      // Should have received follow response with synthetic sub ID
      const followResponse = receivedMessages.find(m => {
        const p = JSON.parse(m);
        return p.id === 1 && p.result;
      });
      expect(followResponse).toBeDefined();

      // Should have received initialized event
      const initEvent = receivedMessages.find(m => {
        const p = JSON.parse(m);
        return p.method === 'chainHead_v1_followEvent' && p.params?.result?.event === 'initialized';
      });
      expect(initEvent).toBeDefined();

      if (initEvent) {
        const parsed = JSON.parse(initEvent);
        expect(parsed.params.result.finalizedBlockHashes).toEqual(['0xaabb0011']);
      }

      expect(followFn).toHaveBeenCalledWith(true);
    });

    it('should handle follow events: newBlock, bestBlockChanged, finalized', async () => {
      const { container, provider } = setup(WellKnownChain.polkadotRelay);
      const receivedMessages: string[] = [];
      let chainOnMessage: ((msg: string) => void) | null = null;

      container.handleFeatureSupported((params, { ok }) =>
        ok(params.tag === 'Chain' && params.value === WellKnownChain.polkadotRelay),
      );

      container.handleChainInteraction(chain => {
        if (chain !== WellKnownChain.polkadotRelay) return null;

        return onMessage => {
          chainOnMessage = onMessage;

          return {
            send(message: string) {
              const parsed = JSON.parse(message);
              if (parsed.method === 'chainHead_v1_follow') {
                onMessage(JSON.stringify({ jsonrpc: '2.0', id: parsed.id, result: 'sub_1' }));
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

      const sdkConnection = provider(msg => receivedMessages.push(msg));

      sdkConnection.send(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'chainHead_v1_follow', params: [false] }));

      await delay(50);

      // Send a series of events
      chainOnMessage!(
        JSON.stringify({
          jsonrpc: '2.0',
          method: 'chainHead_v1_followEvent',
          params: {
            subscription: 'sub_1',
            result: {
              event: 'newBlock',
              blockHash: '0xaa000001',
              parentBlockHash: '0xbb000001',
              newRuntime: null,
            },
          },
        }),
      );

      chainOnMessage!(
        JSON.stringify({
          jsonrpc: '2.0',
          method: 'chainHead_v1_followEvent',
          params: {
            subscription: 'sub_1',
            result: { event: 'bestBlockChanged', bestBlockHash: '0xaa000001' },
          },
        }),
      );

      chainOnMessage!(
        JSON.stringify({
          jsonrpc: '2.0',
          method: 'chainHead_v1_followEvent',
          params: {
            subscription: 'sub_1',
            result: {
              event: 'finalized',
              finalizedBlockHashes: ['0xaa000001'],
              prunedBlockHashes: [],
            },
          },
        }),
      );

      await delay(50);

      const followEvents = receivedMessages
        .map(m => JSON.parse(m))
        .filter(m => m.method === 'chainHead_v1_followEvent');

      expect(followEvents.length).toBe(3);
      expect(followEvents[0].params.result.event).toBe('newBlock');
      expect(followEvents[0].params.result.blockHash).toBe('0xaa000001');
      expect(followEvents[1].params.result.event).toBe('bestBlockChanged');
      expect(followEvents[2].params.result.event).toBe('finalized');
    });
  });

  describe('chainHead header request', () => {
    it('should request header and receive typed result', async () => {
      const { container, provider } = setup(WellKnownChain.polkadotRelay);
      const receivedMessages: string[] = [];

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
              } else if (parsed.method === 'chainHead_v1_header') {
                onMessage(JSON.stringify({ jsonrpc: '2.0', id: parsed.id, result: '0xdd000001' }));
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

      const sdkConnection = provider(msg => receivedMessages.push(msg));

      // Start follow first
      sdkConnection.send(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'chainHead_v1_follow', params: [false] }));

      await delay(50);

      // Get the follow subscription ID from the response
      const followResp = JSON.parse(receivedMessages.find(m => JSON.parse(m).id === 1)!);
      const followSubId = followResp.result;

      // Request header
      sdkConnection.send(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 2,
          method: 'chainHead_v1_header',
          params: [followSubId, '0xcc000001'],
        }),
      );

      await delay(100);

      const headerResp = receivedMessages.find(m => JSON.parse(m).id === 2);
      expect(headerResp).toBeDefined();
      expect(JSON.parse(headerResp!).result).toBe('0xdd000001');
    });
  });

  describe('chainHead storage query', () => {
    it('should handle storage query with operationId response', async () => {
      const { container, provider } = setup(WellKnownChain.polkadotRelay);
      const receivedMessages: string[] = [];

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
              } else if (parsed.method === 'chainHead_v1_storage') {
                onMessage(
                  JSON.stringify({
                    jsonrpc: '2.0',
                    id: parsed.id,
                    result: { result: 'started', operationId: 'op_storage_1' },
                  }),
                );

                // Send storage items event
                setTimeout(() => {
                  onMessage(
                    JSON.stringify({
                      jsonrpc: '2.0',
                      method: 'chainHead_v1_followEvent',
                      params: {
                        subscription: 'sub_1',
                        result: {
                          event: 'operationStorageItems',
                          operationId: 'op_storage_1',
                          items: [
                            { key: '0xee000001', value: '0xff000001', hash: null, closestDescendantMerkleValue: null },
                          ],
                        },
                      },
                    }),
                  );

                  onMessage(
                    JSON.stringify({
                      jsonrpc: '2.0',
                      method: 'chainHead_v1_followEvent',
                      params: {
                        subscription: 'sub_1',
                        result: { event: 'operationStorageDone', operationId: 'op_storage_1' },
                      },
                    }),
                  );
                }, 10);
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

      const sdkConnection = provider(msg => receivedMessages.push(msg));

      // Start follow
      sdkConnection.send(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'chainHead_v1_follow', params: [false] }));
      await delay(50);

      const followSubId = JSON.parse(receivedMessages.find(m => JSON.parse(m).id === 1)!).result;

      // Storage query
      sdkConnection.send(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 2,
          method: 'chainHead_v1_storage',
          params: [followSubId, '0xcc000001', [{ key: '0xee000001', type: 'value' }], null],
        }),
      );

      await delay(100);

      // Should get operation started response
      const storageResp = receivedMessages.find(m => JSON.parse(m).id === 2);
      expect(storageResp).toBeDefined();
      const parsedResp = JSON.parse(storageResp!);
      expect(parsedResp.result.result).toBe('started');
      expect(parsedResp.result.operationId).toBe('op_storage_1');

      // Should get storage items and done events via follow
      const followEvents = receivedMessages
        .map(m => JSON.parse(m))
        .filter(m => m.method === 'chainHead_v1_followEvent');

      const storageItemsEvent = followEvents.find(e => e.params.result.event === 'operationStorageItems');
      expect(storageItemsEvent).toBeDefined();
      expect(storageItemsEvent!.params.result.items[0].key).toBe('0xee000001');
      expect(storageItemsEvent!.params.result.items[0].value).toBe('0xff000001');

      const storageDoneEvent = followEvents.find(e => e.params.result.event === 'operationStorageDone');
      expect(storageDoneEvent).toBeDefined();
    });
  });

  describe('chainHead call operation', () => {
    it('should handle call with operationId and result via follow events', async () => {
      const { container, provider } = setup(WellKnownChain.polkadotRelay);
      const receivedMessages: string[] = [];

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
              } else if (parsed.method === 'chainHead_v1_call') {
                onMessage(
                  JSON.stringify({
                    jsonrpc: '2.0',
                    id: parsed.id,
                    result: { result: 'started', operationId: 'op_call_1' },
                  }),
                );

                setTimeout(() => {
                  onMessage(
                    JSON.stringify({
                      jsonrpc: '2.0',
                      method: 'chainHead_v1_followEvent',
                      params: {
                        subscription: 'sub_1',
                        result: { event: 'operationCallDone', operationId: 'op_call_1', output: '0x11000001' },
                      },
                    }),
                  );
                }, 10);
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

      const sdkConnection = provider(msg => receivedMessages.push(msg));

      sdkConnection.send(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'chainHead_v1_follow', params: [false] }));
      await delay(50);

      const followSubId = JSON.parse(receivedMessages.find(m => JSON.parse(m).id === 1)!).result;

      sdkConnection.send(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 2,
          method: 'chainHead_v1_call',
          params: [followSubId, '0xcc000001', 'Metadata_metadata', '0x'],
        }),
      );

      await delay(100);

      const callResp = JSON.parse(receivedMessages.find(m => JSON.parse(m).id === 2)!);
      expect(callResp.result.result).toBe('started');
      expect(callResp.result.operationId).toBe('op_call_1');

      const callDoneEvent = receivedMessages
        .map(m => JSON.parse(m))
        .find(m => m.method === 'chainHead_v1_followEvent' && m.params.result.event === 'operationCallDone');
      expect(callDoneEvent).toBeDefined();
      expect(callDoneEvent!.params.result.output).toBe('0x11000001');
    });
  });

  describe('chainHead management operations', () => {
    it('should handle unpin request', async () => {
      const { container, provider } = setup(WellKnownChain.polkadotRelay);
      const receivedMessages: string[] = [];
      const unpinFn = vi.fn();

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
              } else if (parsed.method === 'chainHead_v1_unpin') {
                unpinFn(parsed.params);
                onMessage(JSON.stringify({ jsonrpc: '2.0', id: parsed.id, result: null }));
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

      const sdkConnection = provider(msg => receivedMessages.push(msg));

      sdkConnection.send(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'chainHead_v1_follow', params: [false] }));
      await delay(50);

      const followSubId = JSON.parse(receivedMessages.find(m => JSON.parse(m).id === 1)!).result;

      sdkConnection.send(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 2,
          method: 'chainHead_v1_unpin',
          params: [followSubId, ['0xaa000001', '0xaa000002']],
        }),
      );

      await delay(100);

      const unpinResp = receivedMessages.find(m => JSON.parse(m).id === 2);
      expect(unpinResp).toBeDefined();
      expect(JSON.parse(unpinResp!).result).toBe(null);
      expect(unpinFn).toHaveBeenCalled();
    });
  });

  describe('chainSpec queries', () => {
    it('should handle chainSpec genesis hash query', async () => {
      const { container, provider } = setup(WellKnownChain.polkadotRelay);
      const receivedMessages: string[] = [];

      container.handleFeatureSupported((params, { ok }) =>
        ok(params.tag === 'Chain' && params.value === WellKnownChain.polkadotRelay),
      );

      container.handleChainInteraction(chain => {
        if (chain !== WellKnownChain.polkadotRelay) return null;

        return onMessage => {
          return {
            send(message: string) {
              const parsed = JSON.parse(message);
              if (parsed.method === 'chainSpec_v1_genesisHash') {
                onMessage(JSON.stringify({ jsonrpc: '2.0', id: parsed.id, result: WellKnownChain.polkadotRelay }));
              } else if (parsed.method === 'chainSpec_v1_chainName') {
                onMessage(JSON.stringify({ jsonrpc: '2.0', id: parsed.id, result: 'Polkadot' }));
              } else if (parsed.method === 'chainSpec_v1_properties') {
                onMessage(
                  JSON.stringify({
                    jsonrpc: '2.0',
                    id: parsed.id,
                    result: { ss58Format: 0, tokenDecimals: 10, tokenSymbol: 'DOT' },
                  }),
                );
              } else if (parsed.method === 'chainHead_v1_follow') {
                onMessage(JSON.stringify({ jsonrpc: '2.0', id: parsed.id, result: 'sub_1' }));
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

      const sdkConnection = provider(msg => receivedMessages.push(msg));

      // Need to establish follow first for the connection to exist
      sdkConnection.send(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'chainHead_v1_follow', params: [false] }));
      await delay(50);

      // Query genesis hash
      sdkConnection.send(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'chainSpec_v1_genesisHash', params: [] }));

      // Query chain name
      sdkConnection.send(JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'chainSpec_v1_chainName', params: [] }));

      // Query properties
      sdkConnection.send(JSON.stringify({ jsonrpc: '2.0', id: 4, method: 'chainSpec_v1_properties', params: [] }));

      await delay(200);

      const genesisResp = receivedMessages.find(m => JSON.parse(m).id === 2);
      expect(genesisResp).toBeDefined();
      expect(JSON.parse(genesisResp!).result).toBe(WellKnownChain.polkadotRelay);

      const nameResp = receivedMessages.find(m => JSON.parse(m).id === 3);
      expect(nameResp).toBeDefined();
      expect(JSON.parse(nameResp!).result).toBe('Polkadot');

      const propsResp = receivedMessages.find(m => JSON.parse(m).id === 4);
      expect(propsResp).toBeDefined();
      const props = JSON.parse(propsResp!).result;
      expect(props.tokenSymbol).toBe('DOT');
    });
  });

  describe('disconnect and cleanup', () => {
    it('should cleanup follow subscriptions on disconnect', async () => {
      const { container, provider } = setup(WellKnownChain.polkadotRelay);
      const disconnectFn = vi.fn();
      const unfollowFn = vi.fn();

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
              } else if (parsed.method === 'chainHead_v1_unfollow') {
                unfollowFn(parsed.params[0]);
                onMessage(JSON.stringify({ jsonrpc: '2.0', id: parsed.id, result: null }));
              } else {
                onMessage(JSON.stringify({ jsonrpc: '2.0', id: parsed.id, result: null }));
              }
            },
            disconnect: disconnectFn,
          };
        };
      });

      const sdkConnection = provider(() => {
        /* ignore */
      });

      sdkConnection.send(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'chainHead_v1_follow', params: [false] }));

      await delay(50);

      sdkConnection.disconnect();

      await delay(50);

      // The product SDK should have unsubscribed, triggering unfollow on the chain
      expect(disconnectFn).toHaveBeenCalled();
    });
  });

  describe('transaction broadcast and stop', () => {
    function setupDirect() {
      const providers = createHostApiProviders();
      const container = createContainer(providers.host);
      const sdkTransport = createTransport(providers.sdk);
      const hostApi = createHostApi(sdkTransport);
      return { container, hostApi };
    }

    it('should broadcast transaction and receive operation ID', async () => {
      const { container, hostApi } = setupDirect();
      const broadcastFn = vi.fn();

      container.handleChainInteraction(chain => {
        if (chain !== WellKnownChain.polkadotRelay) return null;

        return onMessage => {
          return {
            send(message: string) {
              const parsed = JSON.parse(message);
              if (parsed.method === 'transaction_v1_broadcast') {
                broadcastFn(parsed.params[0]);
                onMessage(JSON.stringify({ jsonrpc: '2.0', id: parsed.id, result: 'tx_op_1' }));
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

      const result = await hostApi.chainTransactionBroadcast(
        enumValue('v1', { genesisHash: WellKnownChain.polkadotRelay, transaction: '0xdeadbeef' as HexString }),
      );

      result.match(
        ok => expect(ok.value).toBe('tx_op_1'),
        () => {
          throw new Error('Expected success');
        },
      );
      expect(broadcastFn).toHaveBeenCalledWith('0xdeadbeef');
    });

    it('should handle broadcast returning null when limit reached', async () => {
      const { container, hostApi } = setupDirect();

      container.handleChainInteraction(chain => {
        if (chain !== WellKnownChain.polkadotRelay) return null;

        return onMessage => {
          return {
            send(message: string) {
              const parsed = JSON.parse(message);
              if (parsed.method === 'transaction_v1_broadcast') {
                onMessage(JSON.stringify({ jsonrpc: '2.0', id: parsed.id, result: null }));
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

      const result = await hostApi.chainTransactionBroadcast(
        enumValue('v1', { genesisHash: WellKnownChain.polkadotRelay, transaction: '0xdeadbeef' as HexString }),
      );

      result.match(
        ok => expect(ok.value).toBe(null),
        () => {
          throw new Error('Expected success');
        },
      );
    });

    it('should stop a broadcast with transaction_v1_stop', async () => {
      const { container, hostApi } = setupDirect();
      const stopFn = vi.fn();

      container.handleChainInteraction(chain => {
        if (chain !== WellKnownChain.polkadotRelay) return null;

        return onMessage => {
          return {
            send(message: string) {
              const parsed = JSON.parse(message);
              if (parsed.method === 'transaction_v1_stop') {
                stopFn(parsed.params[0]);
                onMessage(JSON.stringify({ jsonrpc: '2.0', id: parsed.id, result: null }));
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

      const result = await hostApi.chainTransactionStop(
        enumValue('v1', { genesisHash: WellKnownChain.polkadotRelay, operationId: 'tx_op_1' }),
      );

      result.match(
        () => {
          /* success */
        },
        () => {
          throw new Error('Expected success');
        },
      );
      expect(stopFn).toHaveBeenCalledWith('tx_op_1');
    });
  });

  describe('unsupported chain handling', () => {
    it('should not process requests for unsupported chain', async () => {
      const { container, provider } = setup(WellKnownChain.polkadotRelay);
      const receivedMessages: string[] = [];

      // Feature returns false - chain not supported
      container.handleFeatureSupported((_, { ok }) => ok(false));
      container.handleChainInteraction(chain => {
        if (chain === WellKnownChain.polkadotRelay) {
          return _onMessage => ({
            send() {
              /* empty */
            },
            disconnect() {
              /* empty */
            },
          });
        }
        return null;
      });

      const sdkConnection = provider(msg => receivedMessages.push(msg));

      sdkConnection.send(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'chainHead_v1_follow', params: [false] }));

      await delay(50);

      // Should not receive any messages since feature is not supported
      expect(receivedMessages).toEqual([]);
    });
  });
});
