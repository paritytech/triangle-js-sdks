import type { HexString, Transport } from '@novasamatech/host-api';
import { createHostApi, enumValue, unwrapResultOrThrow } from '@novasamatech/host-api';
import { getSyncProvider } from '@polkadot-api/json-rpc-provider-proxy';
import type { JsonRpcProvider } from 'polkadot-api';

import { sandboxTransport } from './sandboxTransport.js';

type InternalParams = {
  transport?: Transport;
};

export function createPapiProvider(
  genesisHash: HexString,
  // for testing purposes only, should not be used in real production code
  __fallback?: JsonRpcProvider,
  internal?: InternalParams,
): JsonRpcProvider {
  const version = 'v1';
  const transport = internal?.transport ?? sandboxTransport;
  if (!transport.isCorrectEnvironment()) {
    throw new Error('PapiProvider can only be used in a product environment');
  }

  const hostApi = createHostApi(transport);

  type FollowState = {
    syntheticSubId: string;
    subscription: { unsubscribe: () => void };
    genesisHash: HexString;
  };

  const typedProvider: JsonRpcProvider = onMessage => {
    const activeFollows = new Map<string, FollowState>();
    const activeBroadcasts = new Set<string>();
    let nextSubId = 0;

    function getNextSubId() {
      return `follow_${nextSubId++}`;
    }

    function sendJsonRpcResponse(id: number | string, result: unknown) {
      onMessage({ jsonrpc: '2.0', id, result } as Parameters<typeof onMessage>[0]);
    }

    function sendJsonRpcError(id: number | string, code: number, message: string) {
      onMessage({ jsonrpc: '2.0', id, error: { code, message } } as Parameters<typeof onMessage>[0]);
    }

    function sendFollowEvent(syntheticSubId: string, event: unknown) {
      onMessage({
        jsonrpc: '2.0',
        method: 'chainHead_v1_followEvent',
        params: { subscription: syntheticSubId, result: event },
      } as Parameters<typeof onMessage>[0]);
    }

    function convertTypedEventToJsonRpc(event: { tag: string; value: unknown }): unknown {
      switch (event.tag) {
        case 'Initialized': {
          const v = event.value as { finalizedBlockHashes: HexString[]; finalizedBlockRuntime: unknown };
          return {
            event: 'initialized',
            finalizedBlockHashes: v.finalizedBlockHashes,
            finalizedBlockRuntime: convertRuntimeToJsonRpc(v.finalizedBlockRuntime),
          };
        }
        case 'NewBlock': {
          const v = event.value as { blockHash: HexString; parentBlockHash: HexString; newRuntime: unknown };
          return {
            event: 'newBlock',
            blockHash: v.blockHash,
            parentBlockHash: v.parentBlockHash,
            newRuntime: convertRuntimeToJsonRpc(v.newRuntime),
          };
        }
        case 'BestBlockChanged': {
          const v = event.value as { bestBlockHash: HexString };
          return { event: 'bestBlockChanged', bestBlockHash: v.bestBlockHash };
        }
        case 'Finalized': {
          const v = event.value as { finalizedBlockHashes: HexString[]; prunedBlockHashes: HexString[] };
          return {
            event: 'finalized',
            finalizedBlockHashes: v.finalizedBlockHashes,
            prunedBlockHashes: v.prunedBlockHashes,
          };
        }
        case 'OperationBodyDone': {
          const v = event.value as { operationId: string; value: HexString[] };
          return { event: 'operationBodyDone', operationId: v.operationId, value: v.value };
        }
        case 'OperationCallDone': {
          const v = event.value as { operationId: string; output: HexString };
          return { event: 'operationCallDone', operationId: v.operationId, output: v.output };
        }
        case 'OperationStorageItems': {
          const v = event.value as {
            operationId: string;
            items: {
              key: HexString;
              value: HexString | null;
              hash: HexString | null;
              closestDescendantMerkleValue: HexString | null;
            }[];
          };
          return {
            event: 'operationStorageItems',
            operationId: v.operationId,
            items: v.items,
          };
        }
        case 'OperationStorageDone': {
          const v = event.value as { operationId: string };
          return { event: 'operationStorageDone', operationId: v.operationId };
        }
        case 'OperationWaitingForContinue': {
          const v = event.value as { operationId: string };
          return { event: 'operationWaitingForContinue', operationId: v.operationId };
        }
        case 'OperationInaccessible': {
          const v = event.value as { operationId: string };
          return { event: 'operationInaccessible', operationId: v.operationId };
        }
        case 'OperationError': {
          const v = event.value as { operationId: string; error: string };
          return { event: 'operationError', operationId: v.operationId, error: v.error };
        }
        case 'Stop':
          return { event: 'stop' };
        default:
          return { event: 'stop' };
      }
    }

    function convertRuntimeToJsonRpc(runtime: unknown): unknown {
      if (!runtime || typeof runtime !== 'object') return null;

      const rt = runtime as { tag: string; value: unknown };
      if (rt.tag === 'Valid') {
        const spec = rt.value as {
          specName: string;
          implName: string;
          specVersion: number;
          implVersion: number;
          transactionVersion: number | undefined;
          apis: [string, number][];
        };
        const apisObj: Record<string, number> = {};
        for (const [name, ver] of spec.apis) {
          apisObj[name] = ver;
        }
        return {
          type: 'valid',
          spec: {
            specName: spec.specName,
            implName: spec.implName,
            specVersion: spec.specVersion,
            implVersion: spec.implVersion,
            transactionVersion: spec.transactionVersion,
            apis: apisObj,
          },
        };
      }
      if (rt.tag === 'Invalid') {
        const v = rt.value as { error: string };
        return { type: 'invalid', error: v.error };
      }

      return null;
    }

    type StorageQueryTypeValue =
      | 'Value'
      | 'Hash'
      | 'ClosestDescendantMerkleValue'
      | 'DescendantsValues'
      | 'DescendantsHashes';

    function convertStorageTypeToTyped(type: string): StorageQueryTypeValue {
      const map: Record<string, StorageQueryTypeValue> = {
        value: 'Value',
        hash: 'Hash',
        closestDescendantMerkleValue: 'ClosestDescendantMerkleValue',
        descendantsValues: 'DescendantsValues',
        descendantsHashes: 'DescendantsHashes',
      };
      return map[type] ?? 'Value';
    }

    function convertOperationResultToJsonRpc(result: { tag: string; value: unknown }): unknown {
      if (result.tag === 'Started') {
        const v = result.value as { operationId: string };
        return { result: 'started', operationId: v.operationId };
      }
      return { result: 'limitReached' };
    }

    function handleMessage(message: { id?: number | string | null; method?: string; params?: unknown[] }) {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const id = message.id!;
      const { method, params } = message;

      switch (method) {
        case 'chainHead_v1_follow': {
          const [withRuntime] = params as [boolean];
          const syntheticSubId = getNextSubId();

          const subscription = hostApi.chainHeadFollowSubscribe(
            enumValue(version, { genesisHash, withRuntime }),
            payload => {
              if (payload.tag !== version) return;
              const typed = payload.value;
              // On Stop, release the host-api subscription BEFORE forwarding
              // the event. The consumer's substrate-client refollows
              // synchronously inside the event handler; transport.subscribe
              // dedupes by (method, payload-hash), so unless this dead
              // subscription is gone first, the refollow's subscribe shares
              // it and never reaches the host — events stop flowing.
              if (typed.tag === 'Stop' && activeFollows.delete(syntheticSubId)) {
                subscription.unsubscribe();
              }
              sendFollowEvent(syntheticSubId, convertTypedEventToJsonRpc(typed));
            },
          );

          activeFollows.set(syntheticSubId, { syntheticSubId, subscription, genesisHash });
          sendJsonRpcResponse(id, syntheticSubId);
          break;
        }

        case 'chainHead_v1_unfollow': {
          const [followSubId] = params as [string];
          const follow = activeFollows.get(followSubId);
          if (follow) {
            follow.subscription.unsubscribe();
            activeFollows.delete(followSubId);
          }
          sendJsonRpcResponse(id, null);
          break;
        }

        case 'chainHead_v1_header': {
          const [followSubId, hash] = params as [string, HexString];
          hostApi.chainHeadHeader(enumValue(version, { genesisHash, followSubscriptionId: followSubId, hash })).match(
            result => sendJsonRpcResponse(id, result.value),
            error => sendJsonRpcError(id, -32603, error.value.payload.reason),
          );
          break;
        }

        case 'chainHead_v1_body': {
          const [followSubId, hash] = params as [string, HexString];
          hostApi.chainHeadBody(enumValue(version, { genesisHash, followSubscriptionId: followSubId, hash })).match(
            result => sendJsonRpcResponse(id, convertOperationResultToJsonRpc(result.value)),
            error => sendJsonRpcError(id, -32603, error.value.payload.reason),
          );
          break;
        }

        case 'chainHead_v1_storage': {
          const [followSubId, hash, items, childTrie] = params as [
            string,
            HexString,
            { key: HexString; type: string }[],
            HexString | null,
          ];
          const typedItems = items.map(item => ({
            key: item.key,
            queryType: convertStorageTypeToTyped(item.type),
          }));
          hostApi
            .chainHeadStorage(
              enumValue(version, {
                genesisHash,
                followSubscriptionId: followSubId,
                hash,
                items: typedItems,
                childTrie,
              }),
            )
            .match(
              result => sendJsonRpcResponse(id, convertOperationResultToJsonRpc(result.value)),
              error => sendJsonRpcError(id, -32603, error.value.payload.reason),
            );
          break;
        }

        case 'chainHead_v1_call': {
          const [followSubId, hash, fn, callParameters] = params as [string, HexString, string, HexString];
          hostApi
            .chainHeadCall(
              enumValue(version, {
                genesisHash,
                followSubscriptionId: followSubId,
                hash,
                function: fn,
                callParameters,
              }),
            )
            .match(
              result => sendJsonRpcResponse(id, convertOperationResultToJsonRpc(result.value)),
              error => sendJsonRpcError(id, -32603, error.value.payload.reason),
            );
          break;
        }

        case 'chainHead_v1_unpin': {
          const [followSubId, hashOrHashes] = params as [string, HexString | HexString[]];
          const hashes = Array.isArray(hashOrHashes) ? hashOrHashes : [hashOrHashes];
          hostApi.chainHeadUnpin(enumValue(version, { genesisHash, followSubscriptionId: followSubId, hashes })).match(
            () => sendJsonRpcResponse(id, null),
            error => sendJsonRpcError(id, -32603, error.value.payload.reason),
          );
          break;
        }

        case 'chainHead_v1_continue': {
          const [followSubId, operationId] = params as [string, string];
          hostApi
            .chainHeadContinue(enumValue(version, { genesisHash, followSubscriptionId: followSubId, operationId }))
            .match(
              () => sendJsonRpcResponse(id, null),
              error => sendJsonRpcError(id, -32603, error.value.payload.reason),
            );
          break;
        }

        case 'chainHead_v1_stopOperation': {
          const [followSubId, operationId] = params as [string, string];
          hostApi
            .chainHeadStopOperation(enumValue(version, { genesisHash, followSubscriptionId: followSubId, operationId }))
            .match(
              () => sendJsonRpcResponse(id, null),
              error => sendJsonRpcError(id, -32603, error.value.payload.reason),
            );
          break;
        }

        case 'chainSpec_v1_genesisHash': {
          hostApi.chainSpecGenesisHash(enumValue(version, genesisHash)).match(
            result => sendJsonRpcResponse(id, result.value),
            error => sendJsonRpcError(id, -32603, error.value.payload.reason),
          );
          break;
        }

        case 'chainSpec_v1_chainName': {
          hostApi.chainSpecChainName(enumValue(version, genesisHash)).match(
            result => sendJsonRpcResponse(id, result.value),
            error => sendJsonRpcError(id, -32603, error.value.payload.reason),
          );
          break;
        }

        case 'chainSpec_v1_properties': {
          hostApi.chainSpecProperties(enumValue(version, genesisHash)).match(
            result => {
              try {
                sendJsonRpcResponse(id, JSON.parse(result.value));
              } catch {
                sendJsonRpcResponse(id, result.value);
              }
            },
            error => sendJsonRpcError(id, -32603, error.value.payload.reason),
          );
          break;
        }

        case 'transaction_v1_broadcast': {
          const [transaction] = params as [HexString];
          hostApi.chainTransactionBroadcast(enumValue(version, { genesisHash, transaction })).match(
            result => {
              if (result.value !== null) {
                activeBroadcasts.add(result.value);
              }
              sendJsonRpcResponse(id, result.value);
            },
            error => sendJsonRpcError(id, -32603, error.value.payload.reason),
          );
          break;
        }

        case 'transaction_v1_stop': {
          const [operationId] = params as [string];
          activeBroadcasts.delete(operationId);
          hostApi.chainTransactionStop(enumValue(version, { genesisHash, operationId })).match(
            () => sendJsonRpcResponse(id, null),
            error => sendJsonRpcError(id, -32603, error.value.payload.reason),
          );
          break;
        }

        default: {
          sendJsonRpcError(id, -32601, `Method "${method}" is not supported by HostAPI`);
          break;
        }
      }
    }

    return {
      send(message) {
        handleMessage(message);
      },
      disconnect() {
        for (const follow of activeFollows.values()) {
          follow.subscription.unsubscribe();
        }
        activeFollows.clear();
        for (const operationId of activeBroadcasts) {
          hostApi.chainTransactionStop(enumValue(version, { genesisHash, operationId })).match(
            () => {
              /* fire-and-forget on disconnect */
            },
            () => {
              /* transport may already be torn down */
            },
          );
        }
        activeBroadcasts.clear();
      },
    };
  };

  function checkIfReady() {
    return transport.isReady().then(ready => {
      if (!ready) return false;

      return transport
        .request('host_feature_supported', enumValue('v1', enumValue('Chain', genesisHash)))
        .then(payload => {
          switch (payload.tag) {
            case 'v1': {
              return unwrapResultOrThrow(payload.value, e => new Error(e.payload.reason));
            }
            default:
              throw new Error(`Unknown message version ${payload.tag}`);
          }
        })
        .catch(e => {
          transport.provider.logger.error('Error checking chain support', e);
          return false;
        });
    });
  }

  return getSyncProvider(onResult => {
    checkIfReady().then(ready => {
      if (ready) {
        onResult((onMessage, _onHalt) => typedProvider(onMessage));
      } else if (__fallback) {
        onResult((onMessage, _onHalt) => __fallback(onMessage));
      } else {
        onResult((_onMessage, _onHalt) => ({
          send() {
            transport.provider.logger.error(
              `Provider for chain ${genesisHash} was not started because Host doesn't support it`,
            );
          },
          disconnect() {
            /* empty */
          },
        }));
      }
    });
    return () => {
      /* empty */
    };
  });
}
