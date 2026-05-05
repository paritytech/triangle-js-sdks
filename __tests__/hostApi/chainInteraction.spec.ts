/* eslint-disable @typescript-eslint/no-non-null-assertion */

import type { HexString } from '@novasamatech/host-api';
import { createHostApi, createTransport, enumValue } from '@novasamatech/host-api';
import { createContainer } from '@novasamatech/host-container';
import { WellKnownChain, createPapiProvider } from '@novasamatech/product-sdk';

import { describe, expect, it, vi } from 'vitest';

import { delay } from './__mocks__/helpers.js';
import { createHostApiProviders } from './__mocks__/hostApiProviders.js';

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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const receivedMessages: any[] = [];
      const followFn = vi.fn();

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
                followFn(parsed.params[0]);
                // Respond with subscription ID
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                onMessage({ jsonrpc: '2.0', id: parsed.id, result: 'chain_sub_1' } as any);

                // Send initialized event after a tick
                setTimeout(() => {
                  onMessage({
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
                  } as any);
                }, 10);
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

      const sdkConnection = provider(msg => receivedMessages.push(msg));

      // PAPI sends chainHead_v1_follow
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sdkConnection.send({ jsonrpc: '2.0', id: 1, method: 'chainHead_v1_follow', params: [true] } as any);

      await delay(100);

      // Should have received follow response with synthetic sub ID
      const followResponse = receivedMessages.find(m => m.id === 1 && m.result);
      expect(followResponse).toBeDefined();

      // Should have received initialized event
      const initEvent = receivedMessages.find(
        m => m.method === 'chainHead_v1_followEvent' && m.params?.result?.event === 'initialized',
      );
      expect(initEvent).toBeDefined();

      if (initEvent) {
        expect(initEvent.params.result.finalizedBlockHashes).toEqual(['0xaabb0011']);
      }

      expect(followFn).toHaveBeenCalledWith(true);
    });

    it('should handle follow events: newBlock, bestBlockChanged, finalized', async () => {
      const { container, provider } = setup(WellKnownChain.polkadotRelay);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const receivedMessages: any[] = [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let chainOnMessage: ((msg: any) => void) | null = null;

      container.handleFeatureSupported((params, { ok }) =>
        ok(params.tag === 'Chain' && params.value === WellKnownChain.polkadotRelay),
      );

      container.handleChainConnection(chain => {
        if (chain !== WellKnownChain.polkadotRelay) return null;

        return onMessage => {
          chainOnMessage = onMessage;

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
            disconnect() {
              /* empty */
            },
          };
        };
      });

      const sdkConnection = provider(msg => receivedMessages.push(msg));

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sdkConnection.send({ jsonrpc: '2.0', id: 1, method: 'chainHead_v1_follow', params: [false] } as any);

      await delay(100);

      // Send a series of events
      chainOnMessage!({
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
      });

      chainOnMessage!({
        jsonrpc: '2.0',
        method: 'chainHead_v1_followEvent',
        params: {
          subscription: 'sub_1',
          result: { event: 'bestBlockChanged', bestBlockHash: '0xaa000001' },
        },
      });

      chainOnMessage!({
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
      });

      await delay(50);

      const followEvents = receivedMessages.filter(m => m.method === 'chainHead_v1_followEvent');

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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const receivedMessages: any[] = [];

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
              } else if (parsed.method === 'chainHead_v1_header') {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                onMessage({ jsonrpc: '2.0', id: parsed.id, result: '0xdd000001' } as any);
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

      const sdkConnection = provider(msg => receivedMessages.push(msg));

      // Start follow first
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sdkConnection.send({ jsonrpc: '2.0', id: 1, method: 'chainHead_v1_follow', params: [false] } as any);

      await delay(100);

      // Get the follow subscription ID from the response
      const followSubId = receivedMessages.find(m => m.id === 1)!.result;

      // Request header

      sdkConnection.send({
        jsonrpc: '2.0',
        id: 2,
        method: 'chainHead_v1_header',
        params: [followSubId, '0xcc000001'],
      } as any);

      await delay(100);

      const headerResp = receivedMessages.find(m => m.id === 2);
      expect(headerResp).toBeDefined();
      expect(headerResp!.result).toBe('0xdd000001');
    });
  });

  describe('chainHead storage query', () => {
    it('should handle storage query with operationId response', async () => {
      const { container, provider } = setup(WellKnownChain.polkadotRelay);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const receivedMessages: any[] = [];

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
              } else if (parsed.method === 'chainHead_v1_storage') {
                onMessage({
                  jsonrpc: '2.0',
                  id: parsed.id,
                  result: { result: 'started', operationId: 'op_storage_1' },
                } as any);

                // Send storage items event
                setTimeout(() => {
                  onMessage({
                    jsonrpc: '2.0',
                    method: 'chainHead_v1_followEvent',
                    params: {
                      subscription: 'sub_1',
                      result: {
                        event: 'operationStorageItems',
                        operationId: 'op_storage_1',
                        items: [
                          {
                            key: '0xee000001',
                            value: '0xff000001',
                            hash: null,
                            closestDescendantMerkleValue: null,
                          },
                        ],
                      },
                    },
                  } as any);

                  onMessage({
                    jsonrpc: '2.0',
                    method: 'chainHead_v1_followEvent',
                    params: {
                      subscription: 'sub_1',
                      result: { event: 'operationStorageDone', operationId: 'op_storage_1' },
                    },
                  } as any);
                }, 10);
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

      const sdkConnection = provider(msg => receivedMessages.push(msg));

      // Start follow
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sdkConnection.send({ jsonrpc: '2.0', id: 1, method: 'chainHead_v1_follow', params: [false] } as any);
      await delay(100);

      const followSubId = receivedMessages.find(m => m.id === 1)!.result;

      // Storage query

      sdkConnection.send({
        jsonrpc: '2.0',
        id: 2,
        method: 'chainHead_v1_storage',
        params: [followSubId, '0xcc000001', [{ key: '0xee000001', type: 'value' }], null],
      } as any);

      await delay(100);

      // Should get operation started response
      const storageResp = receivedMessages.find(m => m.id === 2);
      expect(storageResp).toBeDefined();
      expect(storageResp!.result.result).toBe('started');
      expect(storageResp!.result.operationId).toBe('op_storage_1');

      // Should get storage items and done events via follow
      const followEvents = receivedMessages.filter(m => m.method === 'chainHead_v1_followEvent');

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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const receivedMessages: any[] = [];

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
              } else if (parsed.method === 'chainHead_v1_call') {
                onMessage({
                  jsonrpc: '2.0',
                  id: parsed.id,
                  result: { result: 'started', operationId: 'op_call_1' },
                } as any);

                setTimeout(() => {
                  onMessage({
                    jsonrpc: '2.0',
                    method: 'chainHead_v1_followEvent',
                    params: {
                      subscription: 'sub_1',
                      result: { event: 'operationCallDone', operationId: 'op_call_1', output: '0x11000001' },
                    },
                  } as any);
                }, 10);
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

      const sdkConnection = provider(msg => receivedMessages.push(msg));

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sdkConnection.send({ jsonrpc: '2.0', id: 1, method: 'chainHead_v1_follow', params: [false] } as any);
      await delay(100);

      const followSubId = receivedMessages.find(m => m.id === 1)!.result;

      sdkConnection.send({
        jsonrpc: '2.0',
        id: 2,
        method: 'chainHead_v1_call',
        params: [followSubId, '0xcc000001', 'Metadata_metadata', '0x'],
      } as any);

      await delay(100);

      const callResp = receivedMessages.find(m => m.id === 2)!;
      expect(callResp.result.result).toBe('started');
      expect(callResp.result.operationId).toBe('op_call_1');

      const callDoneEvent = receivedMessages.find(
        m => m.method === 'chainHead_v1_followEvent' && m.params.result.event === 'operationCallDone',
      );
      expect(callDoneEvent).toBeDefined();
      expect(callDoneEvent!.params.result.output).toBe('0x11000001');
    });
  });

  describe('chainHead management operations', () => {
    it('should handle unpin request', async () => {
      const { container, provider } = setup(WellKnownChain.polkadotRelay);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const receivedMessages: any[] = [];
      const unpinFn = vi.fn();

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
              } else if (parsed.method === 'chainHead_v1_unpin') {
                unpinFn(parsed.params);
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                onMessage({ jsonrpc: '2.0', id: parsed.id, result: null } as any);
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

      const sdkConnection = provider(msg => receivedMessages.push(msg));

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sdkConnection.send({ jsonrpc: '2.0', id: 1, method: 'chainHead_v1_follow', params: [false] } as any);
      await delay(100);

      const followSubId = receivedMessages.find(m => m.id === 1)!.result;

      sdkConnection.send({
        jsonrpc: '2.0',
        id: 2,
        method: 'chainHead_v1_unpin',
        params: [followSubId, ['0xaa000001', '0xaa000002']],
      } as any);

      await delay(100);

      const unpinResp = receivedMessages.find(m => m.id === 2);
      expect(unpinResp).toBeDefined();
      expect(unpinResp!.result).toBe(null);
      expect(unpinFn).toHaveBeenCalled();
    });
  });

  describe('chainSpec queries', () => {
    it('should handle chainSpec genesis hash query', async () => {
      const { container, provider } = setup(WellKnownChain.polkadotRelay);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const receivedMessages: any[] = [];

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
              if (parsed.method === 'chainSpec_v1_genesisHash') {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                onMessage({ jsonrpc: '2.0', id: parsed.id, result: WellKnownChain.polkadotRelay } as any);
              } else if (parsed.method === 'chainSpec_v1_chainName') {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                onMessage({ jsonrpc: '2.0', id: parsed.id, result: 'Polkadot' } as any);
              } else if (parsed.method === 'chainSpec_v1_properties') {
                onMessage({
                  jsonrpc: '2.0',
                  id: parsed.id,
                  result: { ss58Format: 0, tokenDecimals: 10, tokenSymbol: 'DOT' },
                } as any);
              } else if (parsed.method === 'chainHead_v1_follow') {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                onMessage({ jsonrpc: '2.0', id: parsed.id, result: 'sub_1' } as any);
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

      const sdkConnection = provider(msg => receivedMessages.push(msg));

      // Need to establish follow first for the connection to exist
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sdkConnection.send({ jsonrpc: '2.0', id: 1, method: 'chainHead_v1_follow', params: [false] } as any);
      await delay(100);

      // Query genesis hash
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sdkConnection.send({ jsonrpc: '2.0', id: 2, method: 'chainSpec_v1_genesisHash', params: [] } as any);

      // Query chain name
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sdkConnection.send({ jsonrpc: '2.0', id: 3, method: 'chainSpec_v1_chainName', params: [] } as any);

      // Query properties
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sdkConnection.send({ jsonrpc: '2.0', id: 4, method: 'chainSpec_v1_properties', params: [] } as any);

      await delay(200);

      const genesisResp = receivedMessages.find(m => m.id === 2);
      expect(genesisResp).toBeDefined();
      expect(genesisResp!.result).toBe(WellKnownChain.polkadotRelay);

      const nameResp = receivedMessages.find(m => m.id === 3);
      expect(nameResp).toBeDefined();
      expect(nameResp!.result).toBe('Polkadot');

      const propsResp = receivedMessages.find(m => m.id === 4);
      expect(propsResp).toBeDefined();
      expect(propsResp!.result.tokenSymbol).toBe('DOT');
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
              } else if (parsed.method === 'chainHead_v1_unfollow') {
                unfollowFn(parsed.params[0]);
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                onMessage({ jsonrpc: '2.0', id: parsed.id, result: null } as any);
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
        /* ignore */
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sdkConnection.send({ jsonrpc: '2.0', id: 1, method: 'chainHead_v1_follow', params: [false] } as any);

      await delay(100);

      sdkConnection.disconnect();

      await delay(50);

      // The product SDK should have unsubscribed, triggering unfollow on the chain
      expect(unfollowFn).toHaveBeenCalledWith('sub_1');
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

      container.handlePermission((_params, { ok }) => ok(true));
      container.handleChainConnection(chain => {
        if (chain !== WellKnownChain.polkadotRelay) return null;

        return onMessage => {
          return {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            send(message: any) {
              const parsed = message;
              if (parsed.method === 'transaction_v1_broadcast') {
                broadcastFn(parsed.params[0]);
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                onMessage({ jsonrpc: '2.0', id: parsed.id, result: 'tx_op_1' } as any);
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

      container.handlePermission((_params, { ok }) => ok(true));
      container.handleChainConnection(chain => {
        if (chain !== WellKnownChain.polkadotRelay) return null;

        return onMessage => {
          return {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            send(message: any) {
              const parsed = message;
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              onMessage({ jsonrpc: '2.0', id: parsed.id, result: null } as any);
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

      container.handleChainConnection(chain => {
        if (chain !== WellKnownChain.polkadotRelay) return null;

        return onMessage => {
          return {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            send(message: any) {
              const parsed = message;
              if (parsed.method === 'transaction_v1_stop') {
                stopFn(parsed.params[0]);
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                onMessage({ jsonrpc: '2.0', id: parsed.id, result: null } as any);
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

    it('should return permission denied when submitPermission returns false', async () => {
      const { container, hostApi } = setupDirect();

      container.handleChainConnection(chain => {
        if (chain !== WellKnownChain.polkadotRelay) return null;

        return onMessage => {
          return {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            send(message: any) {
              const parsed = message;
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              onMessage({ jsonrpc: '2.0', id: parsed.id, result: null } as any);
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
        () => {
          throw new Error('Expected permission denied');
        },
        err => expect(err.value.payload.reason).toBe('Permission denied'),
      );
    });
  });

  describe('multi-product chain sharing', () => {
    it('should not collide request IDs when two products share the same chain backend', async () => {
      const chainId = WellKnownChain.polkadotRelay;

      // Shared broadcasting chain backend — simulates BranchedProvider behavior
      // where ALL responses from the single RPC connection are broadcast to ALL branches
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const allBranches: ((msg: any) => void)[] = [];
      let subCounter = 0;

      function broadcastingChainFactory(chain: HexString) {
        if (chain !== chainId) return null;

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (onMessage: (msg: any) => void) => {
          allBranches.push(onMessage);

          return {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            send(message: any) {
              const parsed = message;
              if (parsed.method === 'chainHead_v1_follow') {
                subCounter++;
                const subId = `sub_${subCounter}`;
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const response = { jsonrpc: '2.0', id: parsed.id, result: subId } as any;
                // Broadcast to ALL branches (simulating BranchedProvider)
                for (const branch of allBranches) {
                  branch(response);
                }
                // Send initialized event after a tick (also broadcast)
                // Use valid hex strings — invalid hex gets mangled by SCALE encoding roundtrip
                const blockHash = subCounter === 1 ? '0xaa00000000000001' : '0xbb00000000000002';
                setTimeout(() => {
                  const event = {
                    jsonrpc: '2.0',
                    method: 'chainHead_v1_followEvent',
                    params: {
                      subscription: subId,
                      result: {
                        event: 'initialized',
                        finalizedBlockHashes: [blockHash],
                        finalizedBlockRuntime: null,
                      },
                    },
                  } as any;
                  for (const branch of allBranches) {
                    branch(event);
                  }
                }, 10);
              } else if (parsed.method === 'chainHead_v1_unfollow') {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const response = { jsonrpc: '2.0', id: parsed.id, result: null } as any;
                for (const branch of allBranches) {
                  branch(response);
                }
              }
            },
            disconnect() {
              /* empty */
            },
          };
        };
      }

      // Two separate product setups — each with own transport + container
      const providers1 = createHostApiProviders();
      const providers2 = createHostApiProviders();

      const container1 = createContainer(providers1.host);
      const container2 = createContainer(providers2.host);

      container1.handleFeatureSupported((params, { ok }) => ok(params.tag === 'Chain' && params.value === chainId));
      container2.handleFeatureSupported((params, { ok }) => ok(params.tag === 'Chain' && params.value === chainId));

      container1.handleChainConnection(broadcastingChainFactory);
      container2.handleChainConnection(broadcastingChainFactory);

      const sdkTransport1 = createTransport(providers1.sdk);
      const sdkTransport2 = createTransport(providers2.sdk);

      const papiProvider1 = createPapiProvider(chainId, undefined, { transport: sdkTransport1 });
      const papiProvider2 = createPapiProvider(chainId, undefined, { transport: sdkTransport2 });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const messages1: any[] = [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const messages2: any[] = [];

      const conn1 = papiProvider1(msg => messages1.push(msg));
      const conn2 = papiProvider2(msg => messages2.push(msg));

      // Both products start follow simultaneously
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      conn1.send({ jsonrpc: '2.0', id: 1, method: 'chainHead_v1_follow', params: [true] } as any);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      conn2.send({ jsonrpc: '2.0', id: 1, method: 'chainHead_v1_follow', params: [true] } as any);

      await delay(200);

      // Each product should get exactly one follow response
      const followResp1 = messages1.filter(m => m.id === 1 && typeof m.result === 'string');
      const followResp2 = messages2.filter(m => m.id === 1 && typeof m.result === 'string');

      expect(followResp1.length).toBe(1);
      expect(followResp2.length).toBe(1);

      // Each product should receive exactly one initialized event
      const initEvents1 = messages1.filter(
        m => m.method === 'chainHead_v1_followEvent' && m.params?.result?.event === 'initialized',
      );
      const initEvents2 = messages2.filter(
        m => m.method === 'chainHead_v1_followEvent' && m.params?.result?.event === 'initialized',
      );

      expect(initEvents1.length).toBe(1);
      expect(initEvents2.length).toBe(1);

      // Each product should receive initialized events with DIFFERENT block data
      // (sub_1 gets 0xblock_1, sub_2 gets 0xblock_2 from the chain backend).
      // Without the ID collision fix, both would receive 0xblock_1 because both
      // managers would resolve with the same chain subscription ID.
      const blocks1 = initEvents1[0].params.result.finalizedBlockHashes;
      const blocks2 = initEvents2[0].params.result.finalizedBlockHashes;

      expect(blocks1).not.toEqual(blocks2);
      expect([blocks1[0], blocks2[0]].sort()).toEqual(['0xaa00000000000001', '0xbb00000000000002']);
    });
  });

  describe('container disposal', () => {
    it('should send unfollow on container dispose before disconnecting', async () => {
      const { container, provider } = setup(WellKnownChain.polkadotRelay);
      const unfollowFn = vi.fn();
      const disconnectFn = vi.fn();
      const callOrder: string[] = [];

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
              } else if (parsed.method === 'chainHead_v1_unfollow') {
                unfollowFn(parsed.params[0]);
                callOrder.push('unfollow');
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                onMessage({ jsonrpc: '2.0', id: parsed.id, result: null } as any);
              } else {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                onMessage({ jsonrpc: '2.0', id: parsed.id, result: null } as any);
              }
            },
            disconnect() {
              disconnectFn();
              callOrder.push('disconnect');
            },
          };
        };
      });

      const sdkConnection = provider(() => {
        /* ignore */
      });

      // Establish a follow subscription
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sdkConnection.send({ jsonrpc: '2.0', id: 1, method: 'chainHead_v1_follow', params: [false] } as any);

      await delay(100);

      // Dispose the container — should send unfollow before disconnect
      container.dispose();

      await delay(50);

      expect(unfollowFn).toHaveBeenCalledWith('sub_1');
      expect(disconnectFn).toHaveBeenCalled();
      expect(callOrder.indexOf('unfollow')).toBeLessThan(callOrder.indexOf('disconnect'));
    });
  });

  describe('unsupported chain handling', () => {
    it('should not process requests for unsupported chain', async () => {
      const { container, provider } = setup(WellKnownChain.polkadotRelay);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const receivedMessages: any[] = [];

      // Feature returns false - chain not supported
      container.handleFeatureSupported((_, { ok }) => ok(false));
      container.handleChainConnection(chain => {
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

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sdkConnection.send({ jsonrpc: '2.0', id: 1, method: 'chainHead_v1_follow', params: [false] } as any);

      await delay(100);

      // Should not receive any messages since feature is not supported
      expect(receivedMessages).toEqual([]);
    });
  });
});
