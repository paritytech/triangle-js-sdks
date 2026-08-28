import { Enum, ErrEnum, Hex, Nullable, Status } from '@novasamatech/scale';
import { Option, Struct, Tuple, Vector, _void, bool, str, u32 } from 'scale-ts';

import { CallResult } from '../callError.js';
import { GenericErr, GenericError } from '../commonCodecs.js';

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
  genesisHash: Hex(),
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
  genesisHash: Hex(),
  followSubscriptionId: str,
  hash: BlockHash,
});
export const ChainHeadHeaderV1_response = CallResult(Nullable(Hex()), GenericError);

// === ChainHead Body ===

export const ChainHeadBodyV1_request = Struct({
  genesisHash: Hex(),
  followSubscriptionId: str,
  hash: BlockHash,
});
export const ChainHeadBodyV1_response = CallResult(OperationStartedResult, GenericError);

// === ChainHead Storage ===

export const ChainHeadStorageV1_request = Struct({
  genesisHash: Hex(),
  followSubscriptionId: str,
  hash: BlockHash,
  items: Vector(StorageQueryItem),
  childTrie: Nullable(Hex()),
});
export const ChainHeadStorageV1_response = CallResult(OperationStartedResult, GenericError);

// === ChainHead Call ===

export const ChainHeadCallV1_request = Struct({
  genesisHash: Hex(),
  followSubscriptionId: str,
  hash: BlockHash,
  function: str,
  callParameters: Hex(),
});
export const ChainHeadCallV1_response = CallResult(OperationStartedResult, GenericError);

// === ChainHead Unpin ===

export const ChainHeadUnpinV1_request = Struct({
  genesisHash: Hex(),
  followSubscriptionId: str,
  hashes: Vector(BlockHash),
});
export const ChainHeadUnpinV1_response = CallResult(_void, GenericError);

// === ChainHead Continue ===

export const ChainHeadContinueV1_request = Struct({
  genesisHash: Hex(),
  followSubscriptionId: str,
  operationId: OperationId,
});
export const ChainHeadContinueV1_response = CallResult(_void, GenericError);

// === ChainHead StopOperation ===

export const ChainHeadStopOperationV1_request = Struct({
  genesisHash: Hex(),
  followSubscriptionId: str,
  operationId: OperationId,
});
export const ChainHeadStopOperationV1_response = CallResult(_void, GenericError);

// === Chain info ===

// Role of a chain within the host's configured environment.
export const ChainIdentifier = Status('Relay', 'AssetHub', 'People', 'Bulletin');

export const ChainInfoErr = ErrEnum('ChainInfoErr', {
  NotSupported: [_void, 'ChainInfo: the host does not serve the requested chain'],
  Unknown: [GenericErr, 'ChainInfo: unknown error'],
});

export const ChainInfoV1_request = Struct({ chain: ChainIdentifier });
export const ChainInfoV1_response = CallResult(
  Struct({ network: str, chain: ChainIdentifier, genesisHash: Hex(32) }),
  ChainInfoErr,
);

// === ChainSpec ===

export const ChainSpecGenesisHashV1_request = Hex();
export const ChainSpecGenesisHashV1_response = CallResult(Hex(), GenericError);

export const ChainSpecChainNameV1_request = Hex();
export const ChainSpecChainNameV1_response = CallResult(str, GenericError);

export const ChainSpecPropertiesV1_request = Hex();
export const ChainSpecPropertiesV1_response = CallResult(str, GenericError);

// === Transaction Broadcast ===

export const TransactionBroadcastV1_request = Struct({
  genesisHash: Hex(),
  transaction: Hex(),
});
export const TransactionBroadcastV1_response = CallResult(Nullable(str), GenericError);

// === Transaction Stop ===

export const TransactionStopV1_request = Struct({
  genesisHash: Hex(),
  operationId: str,
});
export const TransactionStopV1_response = CallResult(_void, GenericError);
