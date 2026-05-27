import { Enum, Hex, Nullable, Status } from '@novasamatech/scale';
import { Option, Result, Struct, Tuple, Vector, _void, bool, str, u32 } from 'scale-ts';

import { GenericError, GenesisHash } from '../commonCodecs.js';

// === Shared types ===

const BlockHash = Hex();
const OperationId = str;

// === Runtime spec (for follow events with withRuntime=true) ===

const RuntimeApi = Tuple(str, u32);

const RuntimeSpec = Struct({
  specName: str,
  implName: str,
  specVersion: u32,
  implVersion: u32,
  transactionVersion: Option(u32),
  apis: Vector(RuntimeApi),
});

export const RuntimeType = Enum({
  Valid: RuntimeSpec,
  Invalid: Struct({ error: str }),
});

// === Storage types ===

export const StorageQueryType = Status(
  'Value',
  'Hash',
  'ClosestDescendantMerkleValue',
  'DescendantsValues',
  'DescendantsHashes',
);

export const StorageQueryItem = Struct({
  key: Hex(),
  queryType: StorageQueryType,
});

export const StorageResultItem = Struct({
  key: Hex(),
  value: Nullable(Hex()),
  hash: Nullable(Hex()),
  closestDescendantMerkleValue: Nullable(Hex()),
});

// === Operation result (shared by body/storage/call responses) ===

export const OperationStartedResult = Enum({
  Started: Struct({ operationId: OperationId }),
  LimitReached: _void,
});

// === ChainHead Follow ===

export const ChainHeadFollowV1_start = Struct({
  genesisHash: GenesisHash,
  withRuntime: bool,
});

export const ChainHeadEvent = Enum({
  Initialized: Struct({
    finalizedBlockHashes: Vector(BlockHash),
    finalizedBlockRuntime: Option(RuntimeType),
  }),
  NewBlock: Struct({
    blockHash: BlockHash,
    parentBlockHash: BlockHash,
    newRuntime: Option(RuntimeType),
  }),
  BestBlockChanged: Struct({
    bestBlockHash: BlockHash,
  }),
  Finalized: Struct({
    finalizedBlockHashes: Vector(BlockHash),
    prunedBlockHashes: Vector(BlockHash),
  }),
  OperationBodyDone: Struct({
    operationId: OperationId,
    value: Vector(Hex()),
  }),
  OperationCallDone: Struct({
    operationId: OperationId,
    output: Hex(),
  }),
  OperationStorageItems: Struct({
    operationId: OperationId,
    items: Vector(StorageResultItem),
  }),
  OperationStorageDone: Struct({
    operationId: OperationId,
  }),
  OperationWaitingForContinue: Struct({
    operationId: OperationId,
  }),
  OperationInaccessible: Struct({
    operationId: OperationId,
  }),
  OperationError: Struct({
    operationId: OperationId,
    error: str,
  }),
  Stop: _void,
});

export const ChainHeadFollowV1_receive = ChainHeadEvent;
export const ChainHeadFollowV1_interrupt = _void;

// === ChainHead Header ===

export const ChainHeadHeaderV1_request = Struct({
  genesisHash: GenesisHash,
  followSubscriptionId: str,
  hash: BlockHash,
});
export const ChainHeadHeaderV1_response = Result(Nullable(Hex()), GenericError);

// === ChainHead Body ===

export const ChainHeadBodyV1_request = Struct({
  genesisHash: GenesisHash,
  followSubscriptionId: str,
  hash: BlockHash,
});
export const ChainHeadBodyV1_response = Result(OperationStartedResult, GenericError);

// === ChainHead Storage ===

export const ChainHeadStorageV1_request = Struct({
  genesisHash: GenesisHash,
  followSubscriptionId: str,
  hash: BlockHash,
  items: Vector(StorageQueryItem),
  childTrie: Nullable(Hex()),
});
export const ChainHeadStorageV1_response = Result(OperationStartedResult, GenericError);

// === ChainHead Call ===

export const ChainHeadCallV1_request = Struct({
  genesisHash: GenesisHash,
  followSubscriptionId: str,
  hash: BlockHash,
  function: str,
  callParameters: Hex(),
});
export const ChainHeadCallV1_response = Result(OperationStartedResult, GenericError);

// === ChainHead Unpin ===

export const ChainHeadUnpinV1_request = Struct({
  genesisHash: GenesisHash,
  followSubscriptionId: str,
  hashes: Vector(BlockHash),
});
export const ChainHeadUnpinV1_response = Result(_void, GenericError);

// === ChainHead Continue ===

export const ChainHeadContinueV1_request = Struct({
  genesisHash: GenesisHash,
  followSubscriptionId: str,
  operationId: OperationId,
});
export const ChainHeadContinueV1_response = Result(_void, GenericError);

// === ChainHead StopOperation ===

export const ChainHeadStopOperationV1_request = Struct({
  genesisHash: GenesisHash,
  followSubscriptionId: str,
  operationId: OperationId,
});
export const ChainHeadStopOperationV1_response = Result(_void, GenericError);

// === ChainSpec ===

export const ChainSpecGenesisHashV1_request = GenesisHash;
export const ChainSpecGenesisHashV1_response = Result(Hex(), GenericError);

export const ChainSpecChainNameV1_request = GenesisHash;
export const ChainSpecChainNameV1_response = Result(str, GenericError);

export const ChainSpecPropertiesV1_request = GenesisHash;
export const ChainSpecPropertiesV1_response = Result(str, GenericError);

// === Transaction Broadcast ===

export const TransactionBroadcastV1_request = Struct({
  genesisHash: GenesisHash,
  transaction: Hex(),
});
export const TransactionBroadcastV1_response = Result(Nullable(str), GenericError);

// === Transaction Stop ===

export const TransactionStopV1_request = Struct({
  genesisHash: GenesisHash,
  operationId: str,
});
export const TransactionStopV1_response = Result(_void, GenericError);
