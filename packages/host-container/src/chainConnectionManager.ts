import type { HexString } from '@novasamatech/host-api';
import { enumValue } from '@novasamatech/host-api';
import type { FollowResponse, SubstrateClient } from '@polkadot-api/substrate-client';
import { StopError, createClient as createSubstrateClient } from '@polkadot-api/substrate-client';
import type { JsonRpcProvider } from 'polkadot-api';

type FollowEvent = Record<string, unknown>;

type FollowEntry = {
  response: FollowResponse | null;
  onEvent: (event: FollowEvent) => void;
};

type PendingOp = {
  method: string;
  params: unknown[];
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
  timer: ReturnType<typeof setTimeout>;
};

type ChainEntry = {
  client: SubstrateClient;
  follows: Map<string, FollowEntry>;
  pendingOps: PendingOp[];
  // Timestamp of the most recent Stop event for this chain, or null.
  // Treated as "in recovery window" while non-null and within the timeout —
  // chain-head ops issued in this window queue rather than fail.
  recoveringSince: number | null;
  refCount: number;
};

export type ChainConnectionManager = ReturnType<typeof createChainConnectionManager>;

// Operation events that signal a chain-head op is finished and its
// per-operation subscription can be torn down.
const TERMINAL_OPERATION_EVENTS = new Set([
  'operationBodyDone',
  'operationCallDone',
  'operationStorageDone',
  'operationError',
  'operationInaccessible',
]);

// How long to hold a chain-head op when there's no active follow, waiting for
// the papp to issue a fresh Follow after a Stop. Long enough to absorb a
// realistic round-trip; short enough that a never-issuing papp fails fast.
const REFOLLOW_TIMEOUT_MS = 5_000;

function executeChainHeadOp(
  response: FollowResponse,
  onEvent: (event: FollowEvent) => void,
  method: string,
  params: unknown[],
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    response._request<unknown, FollowEvent>(method, params, {
      onSuccess: (result, onSubscribeOperation) => {
        const operationId = (result as { operationId?: string })?.operationId;
        if (operationId) {
          let unsub = (): void => undefined;
          unsub = onSubscribeOperation(operationId, {
            next: e => {
              onEvent(e);
              if (TERMINAL_OPERATION_EVENTS.has(e.event as string)) unsub();
            },
            error: () => unsub(),
          });
        }
        resolve(result);
      },
      onError: reject,
    });
  });
}

export function createChainConnectionManager(
  factory: (genesisHash: HexString) => JsonRpcProvider | null,
  options: { refollowTimeoutMs?: number } = {},
) {
  const refollowTimeoutMs = options.refollowTimeoutMs ?? REFOLLOW_TIMEOUT_MS;
  const chains = new Map<HexString, ChainEntry>();
  let nextFollowId = 0;

  function teardown(entry: ChainEntry) {
    for (const follow of entry.follows.values()) follow.response?.unfollow();
    entry.follows.clear();
    for (const op of entry.pendingOps) {
      clearTimeout(op.timer);
      op.reject(new Error('Chain disposed'));
    }
    entry.pendingOps = [];
    entry.client.destroy();
  }

  function activeFollow(genesisHash: HexString): FollowEntry | null {
    const entry = chains.get(genesisHash);
    if (!entry) return null;
    for (const follow of entry.follows.values()) {
      if (follow.response) return follow;
    }
    return null;
  }

  return {
    getOrCreateChain(genesisHash: HexString): boolean {
      const existing = chains.get(genesisHash);
      if (existing) {
        existing.refCount++;
        return true;
      }
      const provider = factory(genesisHash);
      if (!provider) return false;
      chains.set(genesisHash, {
        client: createSubstrateClient(provider),
        follows: new Map(),
        pendingOps: [],
        recoveringSince: null,
        refCount: 1,
      });
      return true;
    },

    startFollow(
      genesisHash: HexString,
      withRuntime: boolean,
      onEvent: (event: FollowEvent) => void,
    ): { followId: string } {
      const entry = chains.get(genesisHash);
      if (!entry) throw new Error(`No connection for chain ${genesisHash}`);

      const followId = `f${nextFollowId++}`;
      const follow: FollowEntry = { response: null, onEvent };
      entry.follows.set(followId, follow);

      const response = entry.client.chainHead(
        withRuntime,
        // substrate-client renames the spec's `event` field to `type`. Restore it.
        ({ type, ...rest }) => onEvent({ event: type, ...rest } as FollowEvent),
        error => {
          // The follow is dead. Drop the entry so it doesn't accumulate as a
          // tombstone; clear the response field on the (now-detached)
          // FollowEntry for any handle still holding it. For a spec stop,
          // surface the event to the papp and open the recovery window so
          // chain-head ops issued before the papp refollows queue rather
          // than fail. Non-Stop errors get no recovery window — those are
          // genuine failures, not protocol-driven restarts.
          // Explicit unfollow defends against substrate-client retaining
          // pinnedBlocks/runtime past Stop.
          entry.follows.delete(followId);
          follow.response?.unfollow();
          follow.response = null;
          if (error instanceof StopError) {
            onEvent({ event: 'stop' });
            entry.recoveringSince = Date.now();
          }
        },
      );
      follow.response = response;

      // Fresh follow ends any in-flight recovery window. Drain ops queued
      // during the gap through this follow's onEvent so operation events
      // still reach the papp.
      entry.recoveringSince = null;
      if (entry.pendingOps.length > 0) {
        const queued = entry.pendingOps;
        entry.pendingOps = [];
        for (const op of queued) {
          clearTimeout(op.timer);
          executeChainHeadOp(response, onEvent, op.method, op.params).then(op.resolve, op.reject);
        }
      }

      return { followId };
    },

    stopFollow(genesisHash: HexString, followId: string) {
      const entry = chains.get(genesisHash);
      if (!entry) return;
      const follow = entry.follows.get(followId);
      if (!follow) return;
      entry.follows.delete(followId);
      follow.response?.unfollow();
    },

    hasActiveFollow(genesisHash: HexString): boolean {
      return activeFollow(genesisHash) !== null;
    },

    chainHeadOp(genesisHash: HexString, method: string, params: unknown[]): Promise<unknown> {
      const follow = activeFollow(genesisHash);
      if (follow?.response) return executeChainHeadOp(follow.response, follow.onEvent, method, params);

      // No active follow. If we're inside a recovery window opened by a
      // recent Stop, hold the op so the brief gap before the papp's refollow
      // doesn't surface as an error. Otherwise fail fast — no Stop, no
      // expected refollow.
      const entry = chains.get(genesisHash);
      if (!entry || entry.recoveringSince === null) {
        return Promise.reject(new Error('No active follow for this chain'));
      }
      if (Date.now() - entry.recoveringSince > refollowTimeoutMs) {
        entry.recoveringSince = null;
        return Promise.reject(new Error('No active follow for this chain'));
      }
      return new Promise((resolve, reject) => {
        const op: PendingOp = {
          method,
          params,
          resolve,
          reject,
          timer: setTimeout(() => {
            const idx = entry.pendingOps.indexOf(op);
            if (idx !== -1) entry.pendingOps.splice(idx, 1);
            reject(new Error('No active follow for this chain'));
          }, refollowTimeoutMs),
        };
        entry.pendingOps.push(op);
      });
    },

    sendRequest(genesisHash: HexString, method: string, params: unknown[]): Promise<unknown> {
      const entry = chains.get(genesisHash);
      if (!entry) return Promise.reject(new Error(`No connection for chain ${genesisHash}`));
      return entry.client.request(method, params);
    },

    releaseChain(genesisHash: HexString) {
      const entry = chains.get(genesisHash);
      if (!entry) return;
      if (--entry.refCount <= 0) {
        teardown(entry);
        chains.delete(genesisHash);
      }
    },

    dispose() {
      for (const entry of chains.values()) teardown(entry);
      chains.clear();
    },

    convertJsonRpcEventToTyped,
    convertOperationStartedResult,
    convertStorageQueryTypeToJsonRpc,
  };
}

// === JSON-RPC ↔ typed conversion (pure, no closure state) ===

function convertRuntime(runtime: unknown): unknown {
  if (!runtime || typeof runtime !== 'object') return undefined;
  const rt = runtime as Record<string, unknown>;
  if (rt.type === 'valid') {
    const spec = rt.spec as Record<string, unknown>;
    const apis = spec.apis as Record<string, number> | undefined;
    return enumValue('Valid', {
      specName: spec.specName as string,
      implName: spec.implName as string,
      specVersion: spec.specVersion as number,
      implVersion: spec.implVersion as number,
      transactionVersion: spec.transactionVersion as number | undefined,
      apis: apis ? Object.entries(apis).map(([name, version]) => [name, version] as const) : [],
    });
  }
  if (rt.type === 'invalid') return enumValue('Invalid', { error: rt.error as string });
  return undefined;
}

export function convertJsonRpcEventToTyped(event: Record<string, unknown>) {
  switch (event.event as string) {
    case 'initialized':
      return enumValue('Initialized', {
        finalizedBlockHashes: event.finalizedBlockHashes as HexString[],
        finalizedBlockRuntime: convertRuntime(event.finalizedBlockRuntime),
      });
    case 'newBlock':
      return enumValue('NewBlock', {
        blockHash: event.blockHash as HexString,
        parentBlockHash: event.parentBlockHash as HexString,
        newRuntime: convertRuntime(event.newRuntime),
      });
    case 'bestBlockChanged':
      return enumValue('BestBlockChanged', { bestBlockHash: event.bestBlockHash as HexString });
    case 'finalized':
      return enumValue('Finalized', {
        finalizedBlockHashes: event.finalizedBlockHashes as HexString[],
        prunedBlockHashes: event.prunedBlockHashes as HexString[],
      });
    case 'operationBodyDone':
      return enumValue('OperationBodyDone', {
        operationId: event.operationId as string,
        value: event.value as HexString[],
      });
    case 'operationCallDone':
      return enumValue('OperationCallDone', {
        operationId: event.operationId as string,
        output: event.output as HexString,
      });
    case 'operationStorageItems':
      return enumValue('OperationStorageItems', {
        operationId: event.operationId as string,
        items: (event.items as Record<string, unknown>[]).map(item => ({
          key: item.key as HexString,
          value: (item.value as HexString) ?? null,
          hash: (item.hash as HexString) ?? null,
          closestDescendantMerkleValue: (item.closestDescendantMerkleValue as HexString) ?? null,
        })),
      });
    case 'operationStorageDone':
      return enumValue('OperationStorageDone', { operationId: event.operationId as string });
    case 'operationWaitingForContinue':
      return enumValue('OperationWaitingForContinue', { operationId: event.operationId as string });
    case 'operationInaccessible':
      return enumValue('OperationInaccessible', { operationId: event.operationId as string });
    case 'operationError':
      return enumValue('OperationError', {
        operationId: event.operationId as string,
        error: event.error as string,
      });
    case 'stop':
    default:
      return enumValue('Stop', undefined);
  }
}

export function convertOperationStartedResult(result: unknown) {
  const r = result as { result?: string; operationId?: string } | null;
  return r?.result === 'started'
    ? enumValue('Started', { operationId: r.operationId as string })
    : enumValue('LimitReached', undefined);
}

// 'Value' → 'value', 'ClosestDescendantMerkleValue' → 'closestDescendantMerkleValue', …
export function convertStorageQueryTypeToJsonRpc(type: string): string {
  return type.charAt(0).toLowerCase() + type.slice(1);
}
