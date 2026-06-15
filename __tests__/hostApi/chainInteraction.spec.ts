/* eslint-disable @typescript-eslint/no-non-null-assertion */

import type { HexString } from '@novasamatech/host-api';
import { createHostApi, createTransport, enumValue } from '@novasamatech/host-api';
import { WellKnownChain, createPapiProvider } from '@novasamatech/host-api-wrapper';
import { createContainer } from '@novasamatech/host-container';

import type { JsonRpcMessage } from '@polkadot-api/json-rpc-provider';
import type { JsonRpcProvider } from 'polkadot-api';
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
            send(message) {
              if (message.method === 'chainHead_v1_follow') {
                followFn(message.params[0]);
                // Respond with subscription ID

                onMessage({ jsonrpc: '2.0', id: message.id ?? null, result: 'chain_sub_1' });

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
                  });
                }, 10);
              } else {
                onMessage({ jsonrpc: '2.0', id: message.id ?? null, result: null });
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

      sdkConnection.send({ jsonrpc: '2.0', id: 1, method: 'chainHead_v1_follow', params: [true] });

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
            send(message) {
              if (message.method === 'chainHead_v1_follow') {
                onMessage({ jsonrpc: '2.0', id: message.id ?? null, result: 'sub_1' });
              } else {
                onMessage({ jsonrpc: '2.0', id: message.id ?? null, result: null });
              }
            },
            disconnect() {
              /* empty */
            },
          };
        };
      });

      const sdkConnection = provider(msg => receivedMessages.push(msg));

      sdkConnection.send({ jsonrpc: '2.0', id: 1, method: 'chainHead_v1_follow', params: [false] });

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
            send(message) {
              if (message.method === 'chainHead_v1_follow') {
                onMessage({ jsonrpc: '2.0', id: message.id ?? null, result: 'sub_1' });
              } else if (message.method === 'chainHead_v1_header') {
                onMessage({ jsonrpc: '2.0', id: message.id ?? null, result: '0xdd000001' });
              } else {
                onMessage({ jsonrpc: '2.0', id: message.id ?? null, result: null });
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

      sdkConnection.send({ jsonrpc: '2.0', id: 1, method: 'chainHead_v1_follow', params: [false] });

      await delay(100);

      // Get the follow subscription ID from the response
      const followSubId = receivedMessages.find(m => m.id === 1)!.result;

      // Request header

      sdkConnection.send({
        jsonrpc: '2.0',
        id: 2,
        method: 'chainHead_v1_header',
        params: [followSubId, '0xcc000001'],
      });

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
            send(message) {
              if (message.method === 'chainHead_v1_follow') {
                onMessage({ jsonrpc: '2.0', id: message.id ?? null, result: 'sub_1' });
              } else if (message.method === 'chainHead_v1_storage') {
                onMessage({
                  jsonrpc: '2.0',
                  id: message.id ?? null,
                  result: { result: 'started', operationId: 'op_storage_1' },
                });

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
                  });

                  onMessage({
                    jsonrpc: '2.0',
                    method: 'chainHead_v1_followEvent',
                    params: {
                      subscription: 'sub_1',
                      result: { event: 'operationStorageDone', operationId: 'op_storage_1' },
                    },
                  });
                }, 10);
              } else {
                onMessage({ jsonrpc: '2.0', id: message.id ?? null, result: null });
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

      sdkConnection.send({ jsonrpc: '2.0', id: 1, method: 'chainHead_v1_follow', params: [false] });
      await delay(100);

      const followSubId = receivedMessages.find(m => m.id === 1)!.result;

      // Storage query

      sdkConnection.send({
        jsonrpc: '2.0',
        id: 2,
        method: 'chainHead_v1_storage',
        params: [followSubId, '0xcc000001', [{ key: '0xee000001', type: 'value' }], null],
      });

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
            send(message) {
              if (message.method === 'chainHead_v1_follow') {
                onMessage({ jsonrpc: '2.0', id: message.id ?? null, result: 'sub_1' });
              } else if (message.method === 'chainHead_v1_call') {
                onMessage({
                  jsonrpc: '2.0',
                  id: message.id ?? null,
                  result: { result: 'started', operationId: 'op_call_1' },
                });

                setTimeout(() => {
                  onMessage({
                    jsonrpc: '2.0',
                    method: 'chainHead_v1_followEvent',
                    params: {
                      subscription: 'sub_1',
                      result: { event: 'operationCallDone', operationId: 'op_call_1', output: '0x11000001' },
                    },
                  });
                }, 10);
              } else {
                onMessage({ jsonrpc: '2.0', id: message.id ?? null, result: null });
              }
            },
            disconnect() {
              /* empty */
            },
          };
        };
      });

      const sdkConnection = provider(msg => receivedMessages.push(msg));

      sdkConnection.send({ jsonrpc: '2.0', id: 1, method: 'chainHead_v1_follow', params: [false] });
      await delay(100);

      const followSubId = receivedMessages.find(m => m.id === 1)!.result;

      sdkConnection.send({
        jsonrpc: '2.0',
        id: 2,
        method: 'chainHead_v1_call',
        params: [followSubId, '0xcc000001', 'Metadata_metadata', '0x'],
      });

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
            send(message) {
              if (message.method === 'chainHead_v1_follow') {
                onMessage({ jsonrpc: '2.0', id: message.id ?? null, result: 'sub_1' });
              } else if (message.method === 'chainHead_v1_unpin') {
                unpinFn(message.params);

                onMessage({ jsonrpc: '2.0', id: message.id ?? null, result: null });
              } else {
                onMessage({ jsonrpc: '2.0', id: message.id ?? null, result: null });
              }
            },
            disconnect() {
              /* empty */
            },
          };
        };
      });

      const sdkConnection = provider(msg => receivedMessages.push(msg));

      sdkConnection.send({ jsonrpc: '2.0', id: 1, method: 'chainHead_v1_follow', params: [false] });
      await delay(100);

      const followSubId = receivedMessages.find(m => m.id === 1)!.result;

      sdkConnection.send({
        jsonrpc: '2.0',
        id: 2,
        method: 'chainHead_v1_unpin',
        params: [followSubId, ['0xaa000001', '0xaa000002']],
      });

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
            send(message) {
              if (message.method === 'chainSpec_v1_genesisHash') {
                onMessage({ jsonrpc: '2.0', id: message.id ?? null, result: WellKnownChain.polkadotRelay });
              } else if (message.method === 'chainSpec_v1_chainName') {
                onMessage({ jsonrpc: '2.0', id: message.id ?? null, result: 'Polkadot' });
              } else if (message.method === 'chainSpec_v1_properties') {
                onMessage({
                  jsonrpc: '2.0',
                  id: message.id ?? null,
                  result: { ss58Format: 0, tokenDecimals: 10, tokenSymbol: 'DOT' },
                });
              } else if (message.method === 'chainHead_v1_follow') {
                onMessage({ jsonrpc: '2.0', id: message.id ?? null, result: 'sub_1' });
              } else {
                onMessage({ jsonrpc: '2.0', id: message.id ?? null, result: null });
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

      sdkConnection.send({ jsonrpc: '2.0', id: 1, method: 'chainHead_v1_follow', params: [false] });
      await delay(100);

      // Query genesis hash

      sdkConnection.send({ jsonrpc: '2.0', id: 2, method: 'chainSpec_v1_genesisHash', params: [] });

      // Query chain name

      sdkConnection.send({ jsonrpc: '2.0', id: 3, method: 'chainSpec_v1_chainName', params: [] });

      // Query properties

      sdkConnection.send({ jsonrpc: '2.0', id: 4, method: 'chainSpec_v1_properties', params: [] });

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
            send(message) {
              if (message.method === 'chainHead_v1_follow') {
                onMessage({ jsonrpc: '2.0', id: message.id ?? null, result: 'sub_1' });
              } else if (message.method === 'chainHead_v1_unfollow') {
                unfollowFn(message.params[0]);

                onMessage({ jsonrpc: '2.0', id: message.id ?? null, result: null });
              } else {
                onMessage({ jsonrpc: '2.0', id: message.id ?? null, result: null });
              }
            },
            disconnect: disconnectFn,
          };
        };
      });

      const sdkConnection = provider(() => {
        /* ignore */
      });

      sdkConnection.send({ jsonrpc: '2.0', id: 1, method: 'chainHead_v1_follow', params: [false] });

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
            send(message) {
              if (message.method === 'transaction_v1_broadcast') {
                broadcastFn(message.params[0]);

                onMessage({ jsonrpc: '2.0', id: message.id ?? null, result: 'tx_op_1' });
              } else {
                onMessage({ jsonrpc: '2.0', id: message.id ?? null, result: null });
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
            send(message) {
              onMessage({ jsonrpc: '2.0', id: message.id ?? null, result: null });
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

      container.handlePermission((_params, { ok }) => ok(true));
      container.handleChainConnection(chain => {
        if (chain !== WellKnownChain.polkadotRelay) return null;

        return onMessage => {
          return {
            send(message) {
              if (message.method === 'transaction_v1_broadcast') {
                onMessage({ jsonrpc: '2.0', id: message.id ?? null, result: 'tx_op_1' });
              } else if (message.method === 'transaction_v1_stop') {
                stopFn(message.params[0]);

                onMessage({ jsonrpc: '2.0', id: message.id ?? null, result: null });
              } else {
                onMessage({ jsonrpc: '2.0', id: message.id ?? null, result: null });
              }
            },
            disconnect() {
              /* empty */
            },
          };
        };
      });

      // A stop pairs with a prior broadcast, which keeps the connection alive.
      await hostApi.chainTransactionBroadcast(
        enumValue('v1', { genesisHash: WellKnownChain.polkadotRelay, transaction: '0xdeadbeef' as HexString }),
      );

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

    it('should keep the chain connection alive after broadcast until stop', async () => {
      const { container, hostApi } = setupDirect();
      const disconnectFn = vi.fn();

      container.handlePermission((_params, { ok }) => ok(true));
      container.handleChainConnection(chain => {
        if (chain !== WellKnownChain.polkadotRelay) return null;

        return onMessage => {
          return {
            send(message) {
              if (message.method === 'transaction_v1_broadcast') {
                onMessage({ jsonrpc: '2.0', id: message.id ?? null, result: 'tx_op_1' });
              } else {
                onMessage({ jsonrpc: '2.0', id: message.id ?? null, result: null });
              }
            },
            disconnect: disconnectFn,
          };
        };
      });

      const broadcast = await hostApi.chainTransactionBroadcast(
        enumValue('v1', { genesisHash: WellKnownChain.polkadotRelay, transaction: '0xdeadbeef' as HexString }),
      );
      broadcast.match(
        ok => expect(ok.value).toBe('tx_op_1'),
        () => {
          throw new Error('Expected success');
        },
      );

      // The node keeps re-broadcasting only while the connection lives. Tearing
      // it down here would abandon the broadcast (the reported bug).
      expect(disconnectFn).not.toHaveBeenCalled();

      const stop = await hostApi.chainTransactionStop(
        enumValue('v1', { genesisHash: WellKnownChain.polkadotRelay, operationId: 'tx_op_1' }),
      );
      stop.match(
        () => {
          /* success */
        },
        () => {
          throw new Error('Expected success');
        },
      );

      // Once stopped and nothing else holds the chain, it is torn down.
      expect(disconnectFn).toHaveBeenCalled();
    });

    it('should treat a duplicate stop as a no-op and tear down only once', async () => {
      const { container, hostApi } = setupDirect();
      const disconnectFn = vi.fn();
      const stopFn = vi.fn();

      container.handlePermission((_params, { ok }) => ok(true));
      container.handleChainConnection(chain => {
        if (chain !== WellKnownChain.polkadotRelay) return null;

        return onMessage => {
          return {
            send(message) {
              if (message.method === 'transaction_v1_broadcast') {
                onMessage({ jsonrpc: '2.0', id: message.id ?? null, result: 'tx_op_1' });
              } else if (message.method === 'transaction_v1_stop') {
                stopFn(message.params[0]);
                onMessage({ jsonrpc: '2.0', id: message.id ?? null, result: null });
              } else {
                onMessage({ jsonrpc: '2.0', id: message.id ?? null, result: null });
              }
            },
            disconnect: disconnectFn,
          };
        };
      });

      await hostApi.chainTransactionBroadcast(
        enumValue('v1', { genesisHash: WellKnownChain.polkadotRelay, transaction: '0xdeadbeef' as HexString }),
      );

      const first = await hostApi.chainTransactionStop(
        enumValue('v1', { genesisHash: WellKnownChain.polkadotRelay, operationId: 'tx_op_1' }),
      );
      const second = await hostApi.chainTransactionStop(
        enumValue('v1', { genesisHash: WellKnownChain.polkadotRelay, operationId: 'tx_op_1' }),
      );

      for (const result of [first, second]) {
        result.match(
          () => {
            /* both report success */
          },
          () => {
            throw new Error('Expected success');
          },
        );
      }

      // The node-facing stop fires once; the duplicate neither re-sends nor
      // releases a ref, so teardown happens exactly once.
      expect(stopFn).toHaveBeenCalledTimes(1);
      expect(disconnectFn).toHaveBeenCalledTimes(1);
    });

    it('should tear down the connection when broadcast returns null', async () => {
      const { container, hostApi } = setupDirect();
      const disconnectFn = vi.fn();

      container.handlePermission((_params, { ok }) => ok(true));
      container.handleChainConnection(chain => {
        if (chain !== WellKnownChain.polkadotRelay) return null;

        return onMessage => {
          return {
            send(message) {
              onMessage({ jsonrpc: '2.0', id: message.id ?? null, result: null });
            },
            disconnect: disconnectFn,
          };
        };
      });

      const broadcast = await hostApi.chainTransactionBroadcast(
        enumValue('v1', { genesisHash: WellKnownChain.polkadotRelay, transaction: '0xdeadbeef' as HexString }),
      );
      broadcast.match(
        ok => expect(ok.value).toBe(null),
        () => {
          throw new Error('Expected success');
        },
      );

      // No operation id means no stop will ever come, so the ref must be
      // released immediately rather than leaking the connection.
      expect(disconnectFn).toHaveBeenCalled();
    });

    it('should return permission denied when submitPermission returns false', async () => {
      const { container, hostApi } = setupDirect();

      container.handleChainConnection(chain => {
        if (chain !== WellKnownChain.polkadotRelay) return null;

        return onMessage => {
          return {
            send(message) {
              onMessage({ jsonrpc: '2.0', id: message.id ?? null, result: null });
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

      // Shared backend that simulates BranchedProvider: every response is
      // broadcast to ALL onMessage callbacks. Each chainHead_v1_follow gets a
      // distinct subId + a distinct initialized block hash so any cross-leak
      // surfaces as an identical hash on both products.
      const branches: ((msg: JsonRpcMessage) => void)[] = [];
      let subCounter = 0;
      const broadcast = (msg: JsonRpcMessage) => branches.forEach(b => b(msg));
      const sharedFactory = (chain: HexString): JsonRpcProvider | null => {
        if (chain !== chainId) return null;
        return onMessage => {
          branches.push(onMessage);
          return {
            send(message) {
              if (message.method !== 'chainHead_v1_follow') return;
              const subId = `sub_${++subCounter}`;
              const blockHash = `0x${subCounter.toString(16).padStart(16, '0')}` as const;
              broadcast({ jsonrpc: '2.0', id: message.id ?? null, result: subId });
              setTimeout(() => {
                broadcast({
                  jsonrpc: '2.0',
                  method: 'chainHead_v1_followEvent',
                  params: {
                    subscription: subId,
                    result: { event: 'initialized', finalizedBlockHashes: [blockHash], finalizedBlockRuntime: null },
                  },
                });
              }, 10);
            },
            disconnect() {
              /* empty */
            },
          };
        };
      };

      // One product setup; receives messages into its own buffer.
      const createProduct = () => {
        const providers = createHostApiProviders();
        const container = createContainer(providers.host);
        container.handleFeatureSupported((p, { ok }) => ok(p.tag === 'Chain' && p.value === chainId));
        container.handleChainConnection(sharedFactory);
        const messages: JsonRpcMessage[] = [];
        const conn = createPapiProvider(chainId, undefined, { transport: createTransport(providers.sdk) })(msg =>
          messages.push(msg),
        );
        conn.send({ jsonrpc: '2.0', id: 1, method: 'chainHead_v1_follow', params: [true] });
        return messages;
      };

      const messages1 = createProduct();
      const messages2 = createProduct();

      await delay(200);

      type InitNotification = { method: string; params: { result: { finalizedBlockHashes: string[] } } };
      const isFollowResp = (m: JsonRpcMessage) =>
        'id' in m && m.id === 1 && 'result' in m && typeof m.result === 'string';
      const isInit = (m: JsonRpcMessage): m is JsonRpcMessage & InitNotification => {
        if (!('method' in m) || m.method !== 'chainHead_v1_followEvent') return false;
        return (m.params as { result?: { event?: string } } | undefined)?.result?.event === 'initialized';
      };
      const initBlocks = (msgs: JsonRpcMessage[]) => msgs.filter(isInit)[0]!.params.result.finalizedBlockHashes;

      expect(messages1.filter(isFollowResp)).toHaveLength(1);
      expect(messages2.filter(isFollowResp)).toHaveLength(1);
      expect(messages1.filter(isInit)).toHaveLength(1);
      expect(messages2.filter(isInit)).toHaveLength(1);
      // Each product must observe a DIFFERENT block hash. Without the JSON-RPC
      // id-collision fix, the chainConnectionManager would resolve both follows
      // against the same chain subscription and observe identical hashes.
      expect(initBlocks(messages1)).not.toEqual(initBlocks(messages2));
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
            send(message) {
              if (message.method === 'chainHead_v1_follow') {
                onMessage({ jsonrpc: '2.0', id: message.id ?? null, result: 'sub_1' });
              } else if (message.method === 'chainHead_v1_unfollow') {
                unfollowFn(message.params[0]);
                callOrder.push('unfollow');

                onMessage({ jsonrpc: '2.0', id: message.id ?? null, result: null });
              } else {
                onMessage({ jsonrpc: '2.0', id: message.id ?? null, result: null });
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

      sdkConnection.send({ jsonrpc: '2.0', id: 1, method: 'chainHead_v1_follow', params: [false] });

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

      sdkConnection.send({ jsonrpc: '2.0', id: 1, method: 'chainHead_v1_follow', params: [false] });

      await delay(100);

      // Should not receive any messages since feature is not supported
      expect(receivedMessages).toEqual([]);
    });
  });
});
