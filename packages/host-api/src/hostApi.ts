import type { ResultAsync } from 'neverthrow';
import { errAsync, fromPromise, okAsync } from 'neverthrow';

import { extractErrorMessage } from './helpers.js';
import type { CallErrorMarker, CallErrorTransportFailure } from './protocol/callError.js';
import { CALL_ERROR_FAILURE, isCallErrorMarker } from './protocol/callError.js';
import { GenericError } from './protocol/commonCodecs.js';
import type {
  InterruptPayload,
  MethodName,
  ProtocolMethod,
  ProtocolTrait,
  ReceivePayload,
  RequestMethodName,
  RequestPayload,
  ResponsePayload,
  StartPayload,
  SubscriptionMethodName,
  TraitName,
  VersionedProtocolRequest,
  VersionedProtocolSubscription,
} from './protocol/impl.js';
import { hostApiProtocol } from './protocol/impl.js';
import {
  CreateProofErr,
  GetAliasErr,
  GetUserIdErr,
  ListRingVrfKeysErr,
  LoginErr,
  RegisterRingVrfKeyErr,
  RequestCredentialsErr,
  RingVrfSignErr,
  SignVrfErr,
} from './protocol/v1/accounts.js';
import { ChainInfoErr } from './protocol/v1/chainInteraction.js';
import { ChatBotRegistrationErr, ChatMessagePostingErr, ChatRoomRegistrationErr } from './protocol/v1/chat.js';
import { CoinPaymentErr } from './protocol/v1/coinPayment.js';
import { ContactsPickErr } from './protocol/v1/contacts.js';
import { CreateTransactionErr } from './protocol/v1/createTransaction.js';
import { DeriveEntropyErr } from './protocol/v1/deriveEntropy.js';
import { HandshakeErr } from './protocol/v1/handshake.js';
import { StorageErr, StorageReadV2Err } from './protocol/v1/localStorage.js';
import { NavigateToErr } from './protocol/v1/navigation.js';
import { PushNotificationError } from './protocol/v1/notification.js';
import { PaymentRequestErr, PaymentTopUpErr } from './protocol/v1/payments.js';
import { PocketRemoveCardErr } from './protocol/v1/pocket.js';
import { PreimageSubmitErr } from './protocol/v1/preimage.js';
import { ResourceAllocationErr } from './protocol/v1/resourceAllocation.js';
import { SigningErr } from './protocol/v1/sign.js';
import { StatementProofErr } from './protocol/v1/statementStore.js';
import { WorkerErr } from './protocol/v1/worker.js';
import type { Subscription, SubscriptionHandler, Transport } from './types.js';

type UnwrapVersionedResult<T> = T extends { tag: infer Tag; value: infer Value }
  ? ResultAsync<
      {
        tag: Tag;
        value: SuccessResponse<Value>;
      },
      {
        tag: Tag;
        value: ErrorResponse<Value>;
      }
    >
  : never;

type SuccessResponse<T> = T extends { success: true; value: infer U } ? U : never;
type ErrorResponse<T> = T extends { success: false; value: infer U } ? U : never;

/** The versioned domain error a request method answers with. */
type VersionedError<T> = T extends { tag: infer Tag; value: infer Value }
  ? { tag: Tag; value: ErrorResponse<Value> }
  : never;

export type CallOptions = {
  /** Withdraws the call: the host is sent a `Cancel` frame and the call rejects at once. */
  signal?: AbortSignal;
};

type ProductRequestMethodName<T extends TraitName> = {
  [M in RequestMethodName<T>]: ProtocolMethod<T, M> extends VersionedProtocolRequest<any, true> ? never : M;
}[RequestMethodName<T>];

type ProductInitiatedSubscriptionName<T extends TraitName> = {
  [M in SubscriptionMethodName<T>]: ProtocolMethod<T, M> extends VersionedProtocolSubscription<any, 'host'> ? never : M;
}[SubscriptionMethodName<T>];

type HostInitiatedSubscriptionName<T extends TraitName> = Exclude<
  SubscriptionMethodName<T>,
  ProductInitiatedSubscriptionName<T>
>;

type RequestFn<T extends TraitName, M extends RequestMethodName<T>> = (
  args: RequestPayload<T, M>,
  options?: CallOptions,
) => UnwrapVersionedResult<ResponsePayload<T, M>>;

type SubscribeFn<T extends TraitName, M extends SubscriptionMethodName<T>> = (
  args: StartPayload<T, M>,
  callback: (payload: ReceivePayload<T, M>) => void,
) => Subscription<InterruptPayload<T, M>>;

/**
 * A host-initiated subscription: the host starts it and the product serves
 * it, so the product registers a handler instead of subscribing.
 */
type ServeFn<T extends TraitName, M extends SubscriptionMethodName<T>> = (
  handler: SubscriptionHandler<T, M>,
) => VoidFunction;

export type HostApiTrait<T extends TraitName> = {
  [M in ProductRequestMethodName<T>]: RequestFn<T, M>;
} & {
  [M in ProductInitiatedSubscriptionName<T>]: SubscribeFn<T, M>;
} & {
  [M in HostInitiatedSubscriptionName<T>]: ServeFn<T, M>;
};

/**
 * Product-facing host API, nested the way the wire addresses it:
 * `hostApi.<trait>.<method>(...)`, e.g. `hostApi.account.getAccount(...)`.
 */
export type HostApi = {
  [T in TraitName]: HostApiTrait<T>;
};

type TagOf<V> = V extends { tag: infer Tag } ? Tag : never;

type FallbackErrors = {
  [T in TraitName]: {
    [M in ProductRequestMethodName<T>]: (
      reason: string,
      tag: TagOf<RequestPayload<T, M>>,
    ) => VersionedError<ResponsePayload<T, M>>;
  };
};

// Builds a fallback for methods with a single domain error type per version.
const as =
  <E>(make: (reason: string) => E) =>
  <const Tag extends string>(reason: string, tag: Tag) => ({ tag, value: make(reason) });

const generic = as(reason => new GenericError({ reason }));

// The domain error a request folds into when it fails below the domain layer:
// a transport failure (`CallError` other than `Domain`), a rejected send, or a
// malformed response. Products keep a single error type per method.
const fallbackErrors: FallbackErrors = {
  system: {
    handshake: as(reason => new HandshakeErr.Unknown({ reason })),
    featureSupported: generic,
    navigateTo: as(reason => new NavigateToErr.Unknown({ reason })),
    info: generic,
    getProductContext: generic,
  },
  account: {
    getAccount: as(reason => new RequestCredentialsErr.Unknown({ reason })),
    getAccountAlias: as(reason => new GetAliasErr.Unknown({ reason })),
    createAccountProof: as(reason => new CreateProofErr.Unknown({ reason })),
    getLegacyAccounts: as(reason => new RequestCredentialsErr.Unknown({ reason })),
    getUserId: as(reason => new GetUserIdErr.Unknown({ reason })),
    requestLogin: as(reason => new LoginErr.Unknown({ reason })),
    signVrf: as(reason => new SignVrfErr.Unknown({ reason })),
    registerRingVrfKey: as(reason => new RegisterRingVrfKeyErr.Unknown({ reason })),
    listRingVrfKeys: as(reason => new ListRingVrfKeysErr.Unknown({ reason })),
    ringVrfSign: as(reason => new RingVrfSignErr.Unknown({ reason })),
  },
  chain: {
    getHeadHeader: generic,
    getHeadBody: generic,
    getHeadStorage: generic,
    callHead: generic,
    unpinHead: generic,
    continueHead: generic,
    stopHeadOperation: generic,
    getSpecGenesisHash: generic,
    getSpecChainName: generic,
    getSpecProperties: generic,
    broadcastTransaction: generic,
    stopTransaction: generic,
    getChainInfo: as(reason => new ChainInfoErr.Unknown({ reason })),
  },
  chat: {
    createRoom: as(reason => new ChatRoomRegistrationErr.Unknown({ reason })),
    registerBot: as(reason => new ChatBotRegistrationErr.Unknown({ reason })),
    postMessage: as(reason => new ChatMessagePostingErr.Unknown({ reason })),
  },
  coinPayment: {
    createPurse: as(() => new CoinPaymentErr.Internal()),
    queryPurse: as(() => new CoinPaymentErr.Internal()),
    createReceivable: as(() => new CoinPaymentErr.Internal()),
    createCheque: as(() => new CoinPaymentErr.Internal()),
  },
  entropy: {
    derive: as(reason => new DeriveEntropyErr.Unknown({ reason })),
  },
  localStorage: {
    read: (reason, tag) =>
      tag === 'v2'
        ? { tag, value: new StorageReadV2Err.Unknown({ reason }) }
        : { tag, value: new StorageErr.Unknown({ reason }) },
    write: as(reason => new StorageErr.Unknown({ reason })),
    clear: as(reason => new StorageErr.Unknown({ reason })),
  },
  notifications: {
    sendPushNotification: as(reason => new PushNotificationError.Unknown({ reason })),
    cancelPushNotification: generic,
  },
  payment: {
    topUp: as(reason => new PaymentTopUpErr.Unknown({ reason })),
    request: as(reason => new PaymentRequestErr.Unknown({ reason })),
  },
  permissions: {
    requestDevicePermission: generic,
    requestRemotePermission: generic,
  },
  preimage: {
    submit: as(reason => new PreimageSubmitErr.Unknown({ reason })),
  },
  resourceAllocation: {
    request: as(reason => new ResourceAllocationErr.Unknown({ reason })),
  },
  signing: {
    createTransaction: as(reason => new CreateTransactionErr.Unknown({ reason })),
    createTransactionWithLegacyAccount: as(reason => new CreateTransactionErr.Unknown({ reason })),
    signRawWithLegacyAccount: as(reason => new SigningErr.Unknown({ reason })),
    signPayloadWithLegacyAccount: as(reason => new SigningErr.Unknown({ reason })),
    signRaw: as(reason => new SigningErr.Unknown({ reason })),
    signPayload: as(reason => new SigningErr.Unknown({ reason })),
    signRawUnwatermarkedDeprecated: as(reason => new SigningErr.Unknown({ reason })),
    signRawUnwatermarkedDeprecatedWithLegacyAccount: as(reason => new SigningErr.Unknown({ reason })),
  },
  statementStore: {
    createProof: as(reason => new StatementProofErr.Unknown({ reason })),
    submit: generic,
    createProofAuthorized: as(reason => new StatementProofErr.Unknown({ reason })),
  },
  theme: {},
  locale: {},
  renderer: {},
  pocket: {
    removeCard: as(reason => new PocketRemoveCardErr.Unknown({ reason })),
  },
  worker: {
    beginOperation: as(reason => new WorkerErr.Unknown({ reason })),
    endOperation: as(reason => new WorkerErr.Unknown({ reason })),
  },
  contacts: {
    pick: as(reason => new ContactsPickErr.Unknown({ reason })),
  },
};

export function createHostApi(transport: Transport): HostApi {
  const api: Record<string, Record<string, unknown>> = {};

  for (const [trait, { methods }] of Object.entries(hostApiProtocol) as [TraitName, ProtocolTrait][]) {
    const group: Record<string, unknown> = {};
    const fallbacks = fallbackErrors[trait] as Record<
      string,
      (reason: string, tag: string) => { tag: string; value: unknown }
    >;

    for (const [method, definition] of Object.entries(methods)) {
      if (definition.kind === 'request') {
        if (definition.internal) continue;
        const fallback = fallbacks[method];
        if (!fallback) throw new Error(`No fallback error for ${trait}.${method}`);

        group[method] = (args: { tag: string }, options?: CallOptions) =>
          makeRequest(
            transport.request(trait, method as never, args as never, options?.signal) as Promise<{
              tag: string;
              value: { success: boolean; value: unknown } | CallErrorMarker;
            }>,
            reason => fallback(reason, args.tag),
          );
        continue;
      }

      if (definition.initiator === 'host') {
        group[method] = (handler: never) => transport.handleSubscription(trait, method as never, handler);
      } else {
        group[method] = (args: never, callback: never) => transport.subscribe(trait, method as never, args, callback);
      }
    }

    api[trait] = group;
  }

  return api as HostApi;
}

/** Human-readable reason for a transport-level `CallError`, for the domain fallback. */
function describeCallErrorFailure(failure: CallErrorTransportFailure): string {
  switch (failure.tag) {
    case 'Denied':
      return 'call denied by host';
    case 'Unsupported':
      return 'method unsupported by host';
    case 'MalformedFrame':
      return `malformed frame: ${failure.value.reason}`;
    case 'HostFailure':
      return `host failure: ${failure.value.reason}`;
    case 'Cancelled':
      return 'call cancelled';
  }
}

function makeRequest<Tag extends string, R extends { success: boolean; value: unknown }>(
  promise: Promise<{ tag: Tag; value: R | CallErrorMarker }>,
  mapErr: (e: string) => { tag: Tag; value: unknown },
): ResultAsync<{ tag: Tag; value: unknown }, { tag: Tag; value: unknown }> {
  return fromPromise(promise, e => mapErr(extractErrorMessage(e))).andThen(r => {
    const value = r.value;
    // A transport-level CallError carries no domain answer; fold it into the
    // method's domain error so products keep a single error type.
    if (isCallErrorMarker(value)) {
      return errAsync(mapErr(describeCallErrorFailure(value[CALL_ERROR_FAILURE])));
    }
    if (value.success) return okAsync({ tag: r.tag, value: value.value });
    return errAsync({ tag: r.tag, value: value.value });
  });
}

export type { MethodName };
