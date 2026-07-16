import type {
  CodecType,
  ConnectionStatus,
  HexString,
  HostApiMethod,
  HostApiProtocol,
  Provider,
  RequestHandler,
  SubscriptionHandler,
  VersionedProtocolRequest,
  VersionedProtocolSubscription,
} from '@novasamatech/host-api';
import {
  ChatBotRegistrationErr,
  ChatMessagePostingErr,
  ChatRoomRegistrationErr,
  CreateProofErr,
  CreateTransactionErr,
  DeriveEntropyErr,
  DevicePermission,
  GenericError,
  GetAliasErr,
  GetUserIdErr,
  LoginErr,
  NavigateToErr,
  PaymentBalanceErr,
  PaymentRequestErr,
  PaymentStatusErr,
  PaymentTopUpErr,
  PreimageSubmitErr,
  PushNotificationError,
  RemotePermission,
  RequestCredentialsErr,
  ResourceAllocationErr,
  SigningErr,
  StatementProofErr,
  StorageErr,
  createTransport,
  enumValue,
  hostApiProtocol,
  isEnumVariant,
  resultErr,
  resultOk,
} from '@novasamatech/host-api';
import type { Result } from 'neverthrow';
import { err, errAsync, ok, okAsync } from 'neverthrow';

import { createChainConnectionManager } from './chainConnectionManager.js';
import { emitHostApiDebugMessage, registerHostApiDebugSource } from './debugBus.js';
import type {
  CodecValue,
  Container,
  ContainerRequestHandler,
  CreateContainerOptions,
  UnwrapErrorResponse,
} from './types.js';

const UNSUPPORTED_MESSAGE_FORMAT_ERROR = 'Unsupported message format';

const UNSUPPORTED_VERSION_ERROR = 'Unsupported version';

const NOT_IMPLEMENTED = 'Not implemented';

// Wire tag of the only protocol version this container speaks (`v1`).
const V1_VERSION_TAG = 0x00;

type RequestSlot<Method extends HostApiMethod> = {
  update(handler: RequestHandler<Method>): VoidFunction;
  call: RequestHandler<Method>;
  makeCatchAllError(reason: string): ErrorResponse<HostApiProtocol[Method]>;
};

type SubscriptionSlot<Method extends HostApiMethod> = {
  update(handler: SubscriptionHandler<Method>): VoidFunction;
  makeDefaultInterrupt(reason?: string): InterruptPayloadFor<HostApiProtocol[Method]>;
};

type ErrorResponse<Call extends VersionedProtocolRequest | VersionedProtocolSubscription> =
  Call extends VersionedProtocolRequest ? UnwrapErrorResponse<'v1', CodecValue<Call['response']>> : never;

type InterruptPayloadFor<Call extends VersionedProtocolRequest | VersionedProtocolSubscription> =
  Call extends VersionedProtocolSubscription ? CodecValue<Call['interrupt']> : never;

type ContainerRequestHandlerGuard<Call extends VersionedProtocolRequest | VersionedProtocolSubscription> =
  Call extends VersionedProtocolRequest ? ContainerRequestHandler<'v1', Call> : never;

function faultReason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const REQUEST_ID_DECODER = new TextDecoder();

type FrameHeader = {
  requestId: string;
  actionIndex: number;
  payloadOffset: number;
};

/**
 * Reads the `[compact length][utf8 requestId][action id u8]` frame header
 * without touching the (possibly undecodable) payload that follows it.
 * Returns null when even the header does not parse.
 */
function readFrameHeader(frame: Uint8Array): FrameHeader | null {
  const byte = (index: number) => frame[index] ?? 0;
  const first = frame[0];
  if (first === undefined) return null;

  // SCALE compact length prefix of the requestId string. Mode 0b11 encodes
  // lengths >= 2**30 which can never be a sane request id.
  let requestIdLength: number;
  let prefixSize: number;
  switch (first & 0b11) {
    case 0b00:
      requestIdLength = first >>> 2;
      prefixSize = 1;
      break;
    case 0b01:
      if (frame.length < 2) return null;
      requestIdLength = (first + byte(1) * 2 ** 8) >>> 2;
      prefixSize = 2;
      break;
    case 0b10:
      if (frame.length < 4) return null;
      requestIdLength = (first + byte(1) * 2 ** 8 + byte(2) * 2 ** 16 + byte(3) * 2 ** 24) >>> 2;
      prefixSize = 4;
      break;
    default:
      return null;
  }

  const actionOffset = prefixSize + requestIdLength;
  const actionIndex = frame[actionOffset];
  if (actionIndex === undefined) return null;

  return {
    requestId: REQUEST_ID_DECODER.decode(frame.subarray(prefixSize, actionOffset)),
    actionIndex,
    payloadOffset: actionOffset + 1,
  };
}

function guardVersion<const Enum extends { tag: string; value: unknown }, const Tag extends Enum['tag'], const Err>(
  value: Enum | undefined,
  tag: Tag,
  error: Err,
): Result<Enum['value'], Err> {
  if (!value) {
    return err(error);
  }
  if (isEnumVariant(value, tag)) {
    return ok(value.value);
  }
  return err(error);
}

export function createContainer(provider: Provider, options: CreateContainerOptions = {}): Container {
  const transport = createTransport(provider);
  if (!transport.isCorrectEnvironment()) {
    throw new Error('Transport is not available: dapp provider has incorrect environment');
  }
  const { productId } = options;

  // EXPERIMENTAL: forward every transport-level message into the
  // process-global debug bus, tagged with this container's productId.
  // The forwarder is registered as a bus *source* and only attaches to
  // `transport.onDebugMessage` while the bus has at least one subscriber —
  // otherwise the transport's lazy `Message.dec` path stays cold.
  const unregisterGlobalDebugSource = registerHostApiDebugSource(() =>
    transport.onDebugMessage(({ direction, requestId, payload }) => {
      emitHostApiDebugMessage({ direction, productId, requestId, payload });
    }),
  );
  transport.onDestroy(unregisterGlobalDebugSource);

  // Frames whose payload cannot be decoded (unsupported version tag or
  // malformed bytes) throw inside the transport's `Message.dec` before any
  // handler runs, so without a fallback the product side would wait forever.
  // The frame header is still readable, so every served action registers a
  // responder here that answers the method's catch-all terminal frame
  // (response error for requests, default interrupt for subscriptions).
  // Unknown action ids keep the existing drop behavior.
  type DecodeFaultResponder = {
    isDecodable(payload: Uint8Array): boolean;
    respond(requestId: string, reason: string): void;
  };

  const decodeFaultResponders = new Map<number, DecodeFaultResponder>();

  function registerRequestDecodeFault<const Method extends HostApiMethod>(
    method: Method,
    makeError: (reason: string) => ErrorResponse<HostApiProtocol[Method]>,
  ): VoidFunction {
    const protocolEntry = hostApiProtocol[method] as unknown as VersionedProtocolRequest;
    decodeFaultResponders.set(protocolEntry.index, {
      isDecodable: payload => {
        try {
          protocolEntry.request.dec(payload);
          return true;
        } catch {
          return false;
        }
      },
      respond: (requestId, reason) =>
        transport.postMessage(
          requestId,
          enumValue(`${method}_response`, enumValue('v1', resultErr(makeError(reason)))) as never,
        ),
    });
    return () => decodeFaultResponders.delete(protocolEntry.index);
  }

  function registerSubscriptionDecodeFault<const Method extends HostApiMethod>(
    method: Method,
    makeDefaultInterrupt: (reason?: string) => InterruptPayloadFor<HostApiProtocol[Method]>,
  ): VoidFunction {
    const protocolEntry = hostApiProtocol[method] as unknown as VersionedProtocolSubscription;
    decodeFaultResponders.set(protocolEntry.index, {
      isDecodable: payload => {
        try {
          protocolEntry.start.dec(payload);
          return true;
        } catch {
          return false;
        }
      },
      respond: (requestId, reason) =>
        transport.postMessage(requestId, enumValue(`${method}_interrupt`, makeDefaultInterrupt(reason)) as never),
    });
    return () => decodeFaultResponders.delete(protocolEntry.index);
  }

  const unsubscribeDecodeFaultGuard = provider.subscribe(frame => {
    const header = readFrameHeader(frame);
    if (!header) return;

    const responder = decodeFaultResponders.get(header.actionIndex);
    if (!responder) return;

    // Copy rather than subarray: scale-ts decoders misread Uint8Array views
    // that carry a non-zero byteOffset.
    const payload = frame.slice(header.payloadOffset);
    // Re-decoding request/start payloads costs one extra decode per served
    // frame, but it is the only way to know the transport dropped it.
    if (responder.isDecodable(payload)) return;

    const reason =
      payload.length > 0 && payload[0] !== V1_VERSION_TAG
        ? UNSUPPORTED_VERSION_ERROR
        : UNSUPPORTED_MESSAGE_FORMAT_ERROR;
    try {
      responder.respond(header.requestId, reason);
    } catch (error) {
      provider.logger.error('Failed to answer undecodable frame', error);
    }
  });
  transport.onDestroy(unsubscribeDecodeFaultGuard);

  function init() {
    // init status subscription
    transport.isReady();
  }

  function makeRequestSlot<const Method extends HostApiMethod>(
    method: Method,
    defaultHandler: RequestHandler<Method>,
    makeCatchAllError: (reason: string) => ErrorResponse<HostApiProtocol[Method]>,
  ): RequestSlot<Method> {
    let current: RequestHandler<Method> = defaultHandler;
    let version = 0;
    transport.handleRequest(method, params => current(params));
    return {
      update: handler => {
        current = handler;
        const myVersion = ++version;
        return () => {
          if (myVersion !== version) return;
          version++;
          current = defaultHandler;
        };
      },
      call: (...args) => current(...args),
      makeCatchAllError,
    };
  }

  function makeSubscriptionSlot<const Method extends HostApiMethod>(
    method: Method,
    defaultHandler: SubscriptionHandler<Method>,
  ): (handler: SubscriptionHandler<Method>) => VoidFunction {
    let current: SubscriptionHandler<Method> = defaultHandler;
    let version = 0;
    transport.handleSubscription(method, (params, send, interrupt) => current(params, send, interrupt));
    return handler => {
      current = handler;
      const myVersion = ++version;
      return () => {
        if (myVersion !== version) return;
        version++;
        current = defaultHandler;
      };
    };
  }

  function makeNotImplementedSlot<const Method extends HostApiMethod>(
    method: Method,
    makeError: (reason: string) => ErrorResponse<HostApiProtocol[Method]>,
  ): RequestSlot<Method> {
    // Cast needed: async () returns a fixed v1 error shape that TypeScript can't verify
    // matches the generic Method's response type without evaluating template literal types.
    const handler: RequestHandler<Method> = async () =>
      enumValue('v1', resultErr(makeError(NOT_IMPLEMENTED))) as unknown as Awaited<ReturnType<RequestHandler<Method>>>;
    registerRequestDecodeFault(method, makeError);
    return makeRequestSlot(method, handler, makeError);
  }

  function makeInterruptSlot<const Method extends HostApiMethod>(
    method: Method,
    makeDefaultInterrupt: (reason?: string) => InterruptPayloadFor<HostApiProtocol[Method]>,
  ): SubscriptionSlot<Method> {
    const defaultHandler: SubscriptionHandler<Method> = (_params, _send, interrupt) => {
      // Cast needed: the default handler ignores typed params/send which TypeScript can't verify
      // matches the generic Method's subscription type without evaluating template literal types.
      queueMicrotask(() => interrupt(makeDefaultInterrupt() as never));
      return () => {
        /* nothing to clean up */
      };
    };
    registerSubscriptionDecodeFault(method, makeDefaultInterrupt);
    const update = makeSubscriptionSlot(method, defaultHandler);
    return { update, makeDefaultInterrupt };
  }

  function makePermissionGatedRequestSlot<const Method extends HostApiMethod>(
    method: Method,
    permissionVariant: CodecType<typeof RemotePermission>['tag'],
    makeError: (reason: string) => ErrorResponse<HostApiProtocol[Method]>,
  ): RequestSlot<Method> {
    const defaultHandler: RequestHandler<Method> = async () =>
      enumValue('v1', resultErr(makeError(NOT_IMPLEMENTED))) as unknown as Awaited<ReturnType<RequestHandler<Method>>>;
    let current = defaultHandler;
    let version = 0;

    registerRequestDecodeFault(method, makeError);
    transport.handleRequest(method, async params => {
      const permissionResponse = await handleRemotePermissionSlot.call(
        enumValue('v1', enumValue(permissionVariant as never, undefined)),
      );
      const permissionGranted =
        isEnumVariant(permissionResponse, 'v1') &&
        permissionResponse.value.success === true &&
        permissionResponse.value.value === true;
      if (!permissionGranted) {
        return enumValue('v1', resultErr(makeError(NOT_IMPLEMENTED))) as unknown as Awaited<
          ReturnType<RequestHandler<Method>>
        >;
      }
      return current(params);
    });

    return {
      update: handler => {
        current = handler;
        const myVersion = ++version;
        return () => {
          if (myVersion !== version) return;
          version++;
          current = defaultHandler;
        };
      },
      call: (...args) => current(...args),
      makeCatchAllError: makeError,
    };
  }

  function makeDevicePermissionGatedRequestSlot<const Method extends HostApiMethod>(
    method: Method,
    permissionVariant: CodecType<typeof DevicePermission>,
    makeError: (reason: string) => ErrorResponse<HostApiProtocol[Method]>,
  ): RequestSlot<Method> {
    const defaultHandler: RequestHandler<Method> = async () =>
      enumValue('v1', resultErr(makeError(NOT_IMPLEMENTED))) as unknown as Awaited<ReturnType<RequestHandler<Method>>>;
    let current = defaultHandler;
    let version = 0;

    registerRequestDecodeFault(method, makeError);
    transport.handleRequest(method, async params => {
      const permissionResponse = await handleDevicePermissionSlot.call(enumValue('v1', permissionVariant));
      const permissionGranted =
        isEnumVariant(permissionResponse, 'v1') &&
        permissionResponse.value.success === true &&
        permissionResponse.value.value === true;
      if (!permissionGranted) {
        return enumValue('v1', resultErr(makeError(NOT_IMPLEMENTED))) as unknown as Awaited<
          ReturnType<RequestHandler<Method>>
        >;
      }
      return current(params);
    });

    return {
      update: handler => {
        current = handler;
        const myVersion = ++version;
        return () => {
          if (myVersion !== version) return;
          version++;
          current = defaultHandler;
        };
      },
      call: (...args) => current(...args),
      makeCatchAllError: makeError,
    };
  }

  function handleV1Request<const Method extends HostApiMethod>(
    slot: RequestSlot<Method>,
    makeError: () => ErrorResponse<HostApiProtocol[Method]>,
    handler: ContainerRequestHandlerGuard<HostApiProtocol[Method]>,
  ): VoidFunction {
    init();
    const version = 'v1' as const;
    return slot.update(async params => {
      const error = makeError();
      try {
        return (await guardVersion(params, version, error)
          .asyncMap(async p => await handler(p as never, { ok: okAsync<any>, err: errAsync<never, any> }))
          .andThen(r => r.map(v => enumValue(version, resultOk(v))))
          .orElse(r => ok(enumValue(version, resultErr(r))))
          .unwrapOr(enumValue(version, resultErr(error)))) as unknown as Awaited<ReturnType<RequestHandler<Method>>>;
      } catch (thrown) {
        // A throwing or rejecting handler must still answer a terminal frame:
        // reply with the method's catch-all error instead of leaving the
        // product side hanging.
        return enumValue(version, resultErr(slot.makeCatchAllError(faultReason(thrown)))) as unknown as Awaited<
          ReturnType<RequestHandler<Method>>
        >;
      }
    });
  }

  function handleV1Subscription<const Method extends HostApiMethod>(
    slot: SubscriptionSlot<Method>,
    handler: (params: any, send: any, interrupt: any) => VoidFunction,
  ): VoidFunction {
    init();
    const version = 'v1' as const;
    const slotHandler = ((params: unknown, send: unknown, interrupt: (v: unknown) => void) => {
      return guardVersion(params as { tag: string; value: unknown }, version, null)
        .map(p => {
          try {
            return handler(
              p as never,
              ((payload: unknown) => (send as (v: unknown) => void)(enumValue(version, payload))) as never,
              ((payload: unknown) => interrupt(enumValue(version, payload))) as never,
            );
          } catch (thrown) {
            // A throwing start handler must still answer a terminal frame:
            // interrupt with the method's default error instead of leaving
            // the product side hanging.
            interrupt(slot.makeDefaultInterrupt(faultReason(thrown)));
            return () => {
              /* handler failed during start */
            };
          }
        })
        .orTee(() => interrupt(slot.makeDefaultInterrupt()))
        .unwrapOr(() => {
          /* empty */
        });
    }) as SubscriptionHandler<Method>;
    return slot.update(slotHandler);
  }

  // account slots
  const handleGetUserIdSlot = makeNotImplementedSlot(
    'host_get_user_id',
    reason => new GetUserIdErr.Unknown({ reason }),
  );

  const handleRequestLoginSlot = makeNotImplementedSlot(
    'host_request_login',
    reason => new LoginErr.Unknown({ reason }),
  );

  const handleAccountGetSlot = makeNotImplementedSlot(
    'host_account_get',
    reason => new RequestCredentialsErr.Unknown({ reason }),
  );

  const handleAccountGetAliasSlot = makeNotImplementedSlot(
    'host_account_get_alias',
    reason => new GetAliasErr.Unknown({ reason }),
  );

  const handleGetLegacyAccountsSlot = makeNotImplementedSlot(
    'host_get_legacy_accounts',
    reason => new RequestCredentialsErr.Unknown({ reason }),
  );

  const handleAccountCreateProofSlot = makeNotImplementedSlot(
    'host_account_create_proof',
    reason => new CreateProofErr.Unknown({ reason }),
  );

  // entropy derivation slot
  const handleDeriveEntropySlot = makeNotImplementedSlot(
    'host_derive_entropy',
    reason => new DeriveEntropyErr.Unknown({ reason }),
  );

  // storage slots
  const handleLocalStorageReadSlot = makeNotImplementedSlot(
    'host_local_storage_read',
    reason => new StorageErr.Unknown({ reason }),
  );

  const handleLocalStorageWriteSlot = makeNotImplementedSlot(
    'host_local_storage_write',
    reason => new StorageErr.Unknown({ reason }),
  );

  const handleLocalStorageClearSlot = makeNotImplementedSlot(
    'host_local_storage_clear',
    reason => new StorageErr.Unknown({ reason }),
  );

  // signing slots
  const handleSignRawSlot = makeNotImplementedSlot('host_sign_raw', reason => new SigningErr.Unknown({ reason }));

  const handleSignPayloadSlot = makeNotImplementedSlot(
    'host_sign_payload',
    reason => new SigningErr.Unknown({ reason }),
  );

  const handleSignRawWithLegacyAccountSlot = makeNotImplementedSlot(
    'host_sign_raw_with_legacy_account',
    reason => new SigningErr.Unknown({ reason }),
  );

  const handleSignPayloadWithLegacyAccountSlot = makeNotImplementedSlot(
    'host_sign_payload_with_legacy_account',
    reason => new SigningErr.Unknown({ reason }),
  );

  const handleCreateTransactionSlot = makeNotImplementedSlot(
    'host_create_transaction',
    reason => new CreateTransactionErr.Unknown({ reason }),
  );

  const handleCreateTransactionWithLegacyAccountSlot = makeNotImplementedSlot(
    'host_create_transaction_with_legacy_account',
    reason => new CreateTransactionErr.Unknown({ reason }),
  );

  const handleFeatureSupportedSlot = makeNotImplementedSlot(
    'host_feature_supported',
    reason => new GenericError({ reason }),
  );

  const handleDevicePermissionSlot = makeNotImplementedSlot(
    'host_device_permission',
    reason => new GenericError({ reason }),
  );

  const handleRemotePermissionSlot = makeNotImplementedSlot(
    'remote_permission',
    reason => new GenericError({ reason }),
  );

  const handlePushNotificationSlot = makeDevicePermissionGatedRequestSlot(
    'host_push_notification',
    'Notifications',
    reason => new PushNotificationError.Unknown({ reason }),
  );

  const handlePushNotificationCancelSlot = makeDevicePermissionGatedRequestSlot(
    'host_push_notification_cancel',
    'Notifications',
    reason => new GenericError({ reason }),
  );

  const handleNavigateToSlot = makeNotImplementedSlot(
    'host_navigate_to',
    reason => new NavigateToErr.Unknown({ reason }),
  );

  const handleChatCreateRoomSlot = makeNotImplementedSlot(
    'host_chat_create_room',
    reason => new ChatRoomRegistrationErr.Unknown({ reason }),
  );

  const handleChatBotRegistrationSlot = makeNotImplementedSlot(
    'host_chat_register_bot',
    reason => new ChatBotRegistrationErr.Unknown({ reason }),
  );

  const handleChatPostMessageSlot = makeNotImplementedSlot(
    'host_chat_post_message',
    reason => new ChatMessagePostingErr.Unknown({ reason }),
  );

  const handleStatementStoreSubmitSlot = makePermissionGatedRequestSlot(
    'remote_statement_store_submit',
    'StatementSubmit',
    reason => new GenericError({ reason }),
  );

  const handleStatementStoreCreateProofSlot = makeNotImplementedSlot(
    'remote_statement_store_create_proof',
    reason => new StatementProofErr.Unknown({ reason }),
  );

  const handleStatementStoreCreateProofAuthorizedSlot = makeNotImplementedSlot(
    'remote_statement_store_create_proof_authorized',
    reason => new StatementProofErr.Unknown({ reason }),
  );

  const handlePreimageSubmitSlot = makePermissionGatedRequestSlot(
    'remote_preimage_submit',
    'PreimageSubmit',
    reason => new PreimageSubmitErr.Unknown({ reason }),
  );

  // payment request slots
  const handlePaymentTopUpSlot = makeNotImplementedSlot(
    'host_payment_top_up',
    reason => new PaymentTopUpErr.Unknown({ reason }),
  );

  const handlePaymentRequestSlot = makeNotImplementedSlot(
    'host_payment_request',
    reason => new PaymentRequestErr.Unknown({ reason }),
  );

  // resource allocation slot
  const handleRequestResourceAllocationSlot = makeNotImplementedSlot(
    'host_request_resource_allocation',
    reason => new ResourceAllocationErr.Unknown({ reason }),
  );

  // subscription slots — default interrupts on next microtask so that
  // the caller has a chance to register an onInterrupt listener first
  const handleThemeSubscribeSlot = makeInterruptSlot('host_theme_subscribe', () => enumValue('v1', undefined));
  const handleAccountConnectionStatusSubscribeSlot = makeInterruptSlot('host_account_connection_status_subscribe', () =>
    enumValue('v1', undefined),
  );
  const handleChatListSubscribeSlot = makeInterruptSlot('host_chat_list_subscribe', () => enumValue('v1', undefined));
  const handleChatActionSubscribeSlot = makeInterruptSlot('host_chat_action_subscribe', () =>
    enumValue('v1', undefined),
  );
  const handleStatementStoreSubscribeSlot = makeInterruptSlot('remote_statement_store_subscribe', () =>
    enumValue('v1', undefined),
  );
  const handlePreimageLookupSubscribeSlot = makeInterruptSlot('remote_preimage_lookup_subscribe', () =>
    enumValue('v1', undefined),
  );
  const handlePaymentBalanceSubscribeSlot = makeInterruptSlot(
    'host_payment_balance_subscribe',
    (reason = NOT_IMPLEMENTED) => enumValue('v1', new PaymentBalanceErr.Unknown({ reason })),
  );
  const handlePaymentStatusSubscribeSlot = makeInterruptSlot(
    'host_payment_status_subscribe',
    (reason = NOT_IMPLEMENTED) => enumValue('v1', new PaymentStatusErr.Unknown({ reason })),
  );

  return {
    handleFeatureSupported(handler) {
      return handleV1Request(
        handleFeatureSupportedSlot,
        () => new GenericError({ reason: UNSUPPORTED_MESSAGE_FORMAT_ERROR }),
        handler,
      );
    },

    handleDevicePermission(handler) {
      return handleV1Request(
        handleDevicePermissionSlot,
        () => new GenericError({ reason: UNSUPPORTED_MESSAGE_FORMAT_ERROR }),
        handler,
      );
    },

    handlePermission(handler) {
      return handleV1Request(
        handleRemotePermissionSlot,
        () => new GenericError({ reason: UNSUPPORTED_MESSAGE_FORMAT_ERROR }),
        handler,
      );
    },

    handlePushNotification(handler) {
      return handleV1Request(
        handlePushNotificationSlot,
        () => new PushNotificationError.Unknown({ reason: UNSUPPORTED_MESSAGE_FORMAT_ERROR }),
        handler,
      );
    },

    handlePushNotificationCancel(handler) {
      return handleV1Request(
        handlePushNotificationCancelSlot,
        () => new GenericError({ reason: UNSUPPORTED_MESSAGE_FORMAT_ERROR }),
        handler,
      );
    },

    handleNavigateTo(handler) {
      return handleV1Request(
        handleNavigateToSlot,
        () => new NavigateToErr.Unknown({ reason: UNSUPPORTED_MESSAGE_FORMAT_ERROR }),
        handler,
      );
    },

    handleDeriveEntropy(handler) {
      return handleV1Request(
        handleDeriveEntropySlot,
        () => new DeriveEntropyErr.Unknown({ reason: UNSUPPORTED_MESSAGE_FORMAT_ERROR }),
        handler,
      );
    },

    handleLocalStorageRead(handler) {
      return handleV1Request(
        handleLocalStorageReadSlot,
        () => new StorageErr.Unknown({ reason: UNSUPPORTED_MESSAGE_FORMAT_ERROR }),
        handler,
      );
    },

    handleLocalStorageWrite(handler) {
      return handleV1Request(
        handleLocalStorageWriteSlot,
        () => new StorageErr.Unknown({ reason: UNSUPPORTED_MESSAGE_FORMAT_ERROR }),
        handler,
      );
    },

    handleLocalStorageClear(handler) {
      return handleV1Request(
        handleLocalStorageClearSlot,
        () => new StorageErr.Unknown({ reason: UNSUPPORTED_MESSAGE_FORMAT_ERROR }),
        handler,
      );
    },

    handleThemeSubscribe(handler) {
      return handleV1Subscription(handleThemeSubscribeSlot, handler);
    },

    handleGetUserId(handler) {
      return handleV1Request(
        handleGetUserIdSlot,
        () => new GetUserIdErr.Unknown({ reason: UNSUPPORTED_MESSAGE_FORMAT_ERROR }),
        handler,
      );
    },

    handleRequestLogin(handler) {
      return handleV1Request(
        handleRequestLoginSlot,
        () => new LoginErr.Unknown({ reason: UNSUPPORTED_MESSAGE_FORMAT_ERROR }),
        handler,
      );
    },

    handleAccountConnectionStatusSubscribe(handler) {
      return handleV1Subscription(handleAccountConnectionStatusSubscribeSlot, handler);
    },

    handleAccountGet(handler) {
      return handleV1Request(
        handleAccountGetSlot,
        () => new RequestCredentialsErr.Unknown({ reason: UNSUPPORTED_MESSAGE_FORMAT_ERROR }),
        handler,
      );
    },

    handleAccountGetAlias(handler) {
      return handleV1Request(
        handleAccountGetAliasSlot,
        () => new GetAliasErr.Unknown({ reason: UNSUPPORTED_MESSAGE_FORMAT_ERROR }),
        handler,
      );
    },

    handleAccountCreateProof(handler) {
      return handleV1Request(
        handleAccountCreateProofSlot,
        () => new CreateProofErr.Unknown({ reason: UNSUPPORTED_MESSAGE_FORMAT_ERROR }),
        handler,
      );
    },

    handleGetLegacyAccounts(handler) {
      return handleV1Request(
        handleGetLegacyAccountsSlot,
        () => new RequestCredentialsErr.Unknown({ reason: UNSUPPORTED_MESSAGE_FORMAT_ERROR }),
        handler,
      );
    },

    handleCreateTransaction(handler) {
      return handleV1Request(
        handleCreateTransactionSlot,
        () => new CreateTransactionErr.Unknown({ reason: UNSUPPORTED_MESSAGE_FORMAT_ERROR }),
        handler,
      );
    },

    handleCreateTransactionWithLegacyAccount(handler) {
      return handleV1Request(
        handleCreateTransactionWithLegacyAccountSlot,
        () => new CreateTransactionErr.Unknown({ reason: UNSUPPORTED_MESSAGE_FORMAT_ERROR }),
        handler,
      );
    },

    handleSignRaw(handler) {
      return handleV1Request(
        handleSignRawSlot,
        () => new SigningErr.Unknown({ reason: UNSUPPORTED_MESSAGE_FORMAT_ERROR }),
        handler,
      );
    },

    handleSignPayload(handler) {
      return handleV1Request(
        handleSignPayloadSlot,
        () => new SigningErr.Unknown({ reason: UNSUPPORTED_MESSAGE_FORMAT_ERROR }),
        handler,
      );
    },

    handleSignRawWithLegacyAccount(handler) {
      return handleV1Request(
        handleSignRawWithLegacyAccountSlot,
        () => new SigningErr.Unknown({ reason: UNSUPPORTED_MESSAGE_FORMAT_ERROR }),
        handler,
      );
    },

    handleSignPayloadWithLegacyAccount(handler) {
      return handleV1Request(
        handleSignPayloadWithLegacyAccountSlot,
        () => new SigningErr.Unknown({ reason: UNSUPPORTED_MESSAGE_FORMAT_ERROR }),
        handler,
      );
    },

    handleChatCreateRoom(handler) {
      return handleV1Request(
        handleChatCreateRoomSlot,
        () => new ChatRoomRegistrationErr.Unknown({ reason: UNSUPPORTED_MESSAGE_FORMAT_ERROR }),
        handler,
      );
    },

    handleChatBotRegistration(handler) {
      return handleV1Request(
        handleChatBotRegistrationSlot,
        () => new ChatBotRegistrationErr.Unknown({ reason: UNSUPPORTED_MESSAGE_FORMAT_ERROR }),
        handler,
      );
    },

    handleChatListSubscribe(handler) {
      return handleV1Subscription(handleChatListSubscribeSlot, handler);
    },

    handleChatPostMessage(handler) {
      return handleV1Request(
        handleChatPostMessageSlot,
        () => new ChatMessagePostingErr.Unknown({ reason: UNSUPPORTED_MESSAGE_FORMAT_ERROR }),
        handler,
      );
    },

    handleChatActionSubscribe(handler) {
      return handleV1Subscription(handleChatActionSubscribeSlot, handler);
    },

    renderChatCustomMessage({ messageId, messageType, payload }, callback) {
      init();
      return transport.subscribe(
        'product_chat_custom_message_render_subscribe',
        enumValue('v1', { messageId, messageType, payload }),
        value => {
          if (value.tag === 'v1') {
            callback(value.value);
          }
        },
      );
    },

    handleStatementStoreSubscribe(handler) {
      return handleV1Subscription(handleStatementStoreSubscribeSlot, handler);
    },

    handleStatementStoreCreateProof(handler) {
      return handleV1Request(
        handleStatementStoreCreateProofSlot,
        () => new StatementProofErr.Unknown({ reason: UNSUPPORTED_MESSAGE_FORMAT_ERROR }),
        handler,
      );
    },

    handleStatementStoreCreateProofAuthorized(handler) {
      return handleV1Request(
        handleStatementStoreCreateProofAuthorizedSlot,
        () => new StatementProofErr.Unknown({ reason: UNSUPPORTED_MESSAGE_FORMAT_ERROR }),
        handler,
      );
    },

    handleStatementStoreSubmit(handler) {
      return handleV1Request(
        handleStatementStoreSubmitSlot,
        () => new GenericError({ reason: UNSUPPORTED_MESSAGE_FORMAT_ERROR }),
        handler,
      );
    },

    handlePreimageLookupSubscribe(handler) {
      return handleV1Subscription(handlePreimageLookupSubscribeSlot, handler);
    },

    handlePreimageSubmit(handler) {
      return handleV1Request(
        handlePreimageSubmitSlot,
        () => new PreimageSubmitErr.Unknown({ reason: UNSUPPORTED_MESSAGE_FORMAT_ERROR }),
        handler,
      );
    },

    handlePaymentBalanceSubscribe(handler) {
      return handleV1Subscription(handlePaymentBalanceSubscribeSlot, handler);
    },

    handlePaymentTopUp(handler) {
      return handleV1Request(
        handlePaymentTopUpSlot,
        () => new PaymentTopUpErr.Unknown({ reason: UNSUPPORTED_MESSAGE_FORMAT_ERROR }),
        handler,
      );
    },

    handlePaymentRequest(handler) {
      return handleV1Request(
        handlePaymentRequestSlot,
        () => new PaymentRequestErr.Unknown({ reason: UNSUPPORTED_MESSAGE_FORMAT_ERROR }),
        handler,
      );
    },

    handlePaymentStatusSubscribe(handler) {
      return handleV1Subscription(handlePaymentStatusSubscribeSlot, handler);
    },

    handleRequestResourceAllocation(handler) {
      return handleV1Request(
        handleRequestResourceAllocationSlot,
        () => new ResourceAllocationErr.Unknown({ reason: UNSUPPORTED_MESSAGE_FORMAT_ERROR }),
        handler,
      );
    },

    // chain interaction

    handleChainConnection(factory) {
      init();
      const manager = createChainConnectionManager(factory);
      const cleanups: VoidFunction[] = [];
      // `${genesisHash}:${operationId}` for each broadcast holding a chain ref.
      const liveBroadcasts = new Set<string>();

      // Undecodable chain frames answer terminal frames through the same
      // catch-all machinery as the slot-based methods above.
      const chainFaultMethods = [
        'remote_chain_head_header',
        'remote_chain_head_body',
        'remote_chain_head_storage',
        'remote_chain_head_call',
        'remote_chain_head_unpin',
        'remote_chain_head_continue',
        'remote_chain_head_stop_operation',
        'remote_chain_spec_genesis_hash',
        'remote_chain_spec_chain_name',
        'remote_chain_spec_properties',
        'remote_chain_transaction_broadcast',
        'remote_chain_transaction_stop',
      ] as const;
      for (const method of chainFaultMethods) {
        cleanups.push(registerRequestDecodeFault(method, reason => new GenericError({ reason })));
      }
      cleanups.push(
        registerSubscriptionDecodeFault('remote_chain_head_follow_subscribe', () => enumValue('v1', undefined)),
      );

      // Follow subscription
      cleanups.push(
        transport.handleSubscription('remote_chain_head_follow_subscribe', (params, send, interrupt) => {
          if (!isEnumVariant(params, 'v1')) {
            interrupt(enumValue('v1', undefined));
            return () => {
              /* unsupported version */
            };
          }
          const { genesisHash, withRuntime } = params.value;

          const entry = manager.getOrCreateChain(genesisHash);
          if (!entry) {
            interrupt(enumValue('v1', undefined));
            return () => {
              /* no chain provider available */
            };
          }

          const { followId } = manager.startFollow(genesisHash, withRuntime, (event: unknown) => {
            const typedEvent = manager.convertJsonRpcEventToTyped(event as Record<string, unknown>);
            (send as (v: unknown) => void)(enumValue('v1', typedEvent));
          });

          return () => {
            manager.stopFollow(genesisHash, followId);
            manager.releaseChain(genesisHash);
          };
        }),
      );

      // Header request
      cleanups.push(
        transport.handleRequest('remote_chain_head_header', async message => {
          if (!isEnumVariant(message, 'v1')) {
            return enumValue('v1', resultErr(new GenericError({ reason: UNSUPPORTED_MESSAGE_FORMAT_ERROR })));
          }
          const { genesisHash, hash } = message.value;

          if (!manager.hasActiveFollow(genesisHash)) {
            return enumValue('v1', resultErr(new GenericError({ reason: 'No active follow for this chain' })));
          }

          try {
            const result = await manager.chainHeadOp(genesisHash, 'chainHead_v1_header', [hash]);
            return enumValue('v1', resultOk(result as HexString | null));
          } catch (e) {
            return enumValue('v1', resultErr(new GenericError({ reason: String(e) })));
          }
        }),
      );

      // Body request
      cleanups.push(
        transport.handleRequest('remote_chain_head_body', async message => {
          if (!isEnumVariant(message, 'v1')) {
            return enumValue('v1', resultErr(new GenericError({ reason: UNSUPPORTED_MESSAGE_FORMAT_ERROR })));
          }
          const { genesisHash, hash } = message.value;

          if (!manager.hasActiveFollow(genesisHash)) {
            return enumValue('v1', resultErr(new GenericError({ reason: 'No active follow for this chain' })));
          }

          try {
            const result = await manager.chainHeadOp(genesisHash, 'chainHead_v1_body', [hash]);
            return enumValue('v1', resultOk(manager.convertOperationStartedResult(result)));
          } catch (e) {
            return enumValue('v1', resultErr(new GenericError({ reason: String(e) })));
          }
        }),
      );

      // Storage request
      cleanups.push(
        transport.handleRequest('remote_chain_head_storage', async message => {
          if (!isEnumVariant(message, 'v1')) {
            return enumValue('v1', resultErr(new GenericError({ reason: UNSUPPORTED_MESSAGE_FORMAT_ERROR })));
          }
          const { genesisHash, hash, items, childTrie } = message.value;

          if (!manager.hasActiveFollow(genesisHash)) {
            return enumValue('v1', resultErr(new GenericError({ reason: 'No active follow for this chain' })));
          }

          const jsonRpcItems = items.map((item: { key: HexString; queryType: string }) => ({
            key: item.key,
            type: manager.convertStorageQueryTypeToJsonRpc(item.queryType),
          }));

          try {
            const result = await manager.chainHeadOp(genesisHash, 'chainHead_v1_storage', [
              hash,
              jsonRpcItems,
              childTrie,
            ]);
            return enumValue('v1', resultOk(manager.convertOperationStartedResult(result)));
          } catch (e) {
            return enumValue('v1', resultErr(new GenericError({ reason: String(e) })));
          }
        }),
      );

      // Call request
      cleanups.push(
        transport.handleRequest('remote_chain_head_call', async message => {
          if (!isEnumVariant(message, 'v1')) {
            return enumValue('v1', resultErr(new GenericError({ reason: UNSUPPORTED_MESSAGE_FORMAT_ERROR })));
          }
          const params = message.value;

          if (!manager.hasActiveFollow(params.genesisHash)) {
            return enumValue('v1', resultErr(new GenericError({ reason: 'No active follow for this chain' })));
          }

          try {
            const result = await manager.chainHeadOp(params.genesisHash, 'chainHead_v1_call', [
              params.hash,
              params.function,
              params.callParameters,
            ]);
            return enumValue('v1', resultOk(manager.convertOperationStartedResult(result)));
          } catch (e) {
            return enumValue('v1', resultErr(new GenericError({ reason: String(e) })));
          }
        }),
      );

      // Unpin request
      cleanups.push(
        transport.handleRequest('remote_chain_head_unpin', async message => {
          if (!isEnumVariant(message, 'v1')) {
            return enumValue('v1', resultErr(new GenericError({ reason: UNSUPPORTED_MESSAGE_FORMAT_ERROR })));
          }
          const { genesisHash, hashes } = message.value;

          if (!manager.hasActiveFollow(genesisHash)) {
            return enumValue('v1', resultErr(new GenericError({ reason: 'No active follow for this chain' })));
          }

          try {
            await manager.chainHeadOp(genesisHash, 'chainHead_v1_unpin', [hashes]);
            return enumValue('v1', resultOk(undefined));
          } catch (e) {
            return enumValue('v1', resultErr(new GenericError({ reason: String(e) })));
          }
        }),
      );

      // Continue request
      cleanups.push(
        transport.handleRequest('remote_chain_head_continue', async message => {
          if (!isEnumVariant(message, 'v1')) {
            return enumValue('v1', resultErr(new GenericError({ reason: UNSUPPORTED_MESSAGE_FORMAT_ERROR })));
          }
          const { genesisHash, operationId } = message.value;

          if (!manager.hasActiveFollow(genesisHash)) {
            return enumValue('v1', resultErr(new GenericError({ reason: 'No active follow for this chain' })));
          }

          try {
            await manager.chainHeadOp(genesisHash, 'chainHead_v1_continue', [operationId]);
            return enumValue('v1', resultOk(undefined));
          } catch (e) {
            return enumValue('v1', resultErr(new GenericError({ reason: String(e) })));
          }
        }),
      );

      // StopOperation request
      cleanups.push(
        transport.handleRequest('remote_chain_head_stop_operation', async message => {
          if (!isEnumVariant(message, 'v1')) {
            return enumValue('v1', resultErr(new GenericError({ reason: UNSUPPORTED_MESSAGE_FORMAT_ERROR })));
          }
          const { genesisHash, operationId } = message.value;

          if (!manager.hasActiveFollow(genesisHash)) {
            return enumValue('v1', resultErr(new GenericError({ reason: 'No active follow for this chain' })));
          }

          try {
            await manager.chainHeadOp(genesisHash, 'chainHead_v1_stopOperation', [operationId]);
            return enumValue('v1', resultOk(undefined));
          } catch (e) {
            return enumValue('v1', resultErr(new GenericError({ reason: String(e) })));
          }
        }),
      );

      // ChainSpec: genesis hash
      cleanups.push(
        transport.handleRequest('remote_chain_spec_genesis_hash', async message => {
          if (!isEnumVariant(message, 'v1')) {
            return enumValue('v1', resultErr(new GenericError({ reason: UNSUPPORTED_MESSAGE_FORMAT_ERROR })));
          }
          const genesisHash = message.value;

          const entry = manager.getOrCreateChain(genesisHash);
          if (!entry) {
            return enumValue('v1', resultErr(new GenericError({ reason: 'Chain not supported' })));
          }

          try {
            const result = await manager.sendRequest(genesisHash, 'chainSpec_v1_genesisHash', []);
            manager.releaseChain(genesisHash);
            return enumValue('v1', resultOk(result as HexString));
          } catch (e) {
            manager.releaseChain(genesisHash);
            return enumValue('v1', resultErr(new GenericError({ reason: String(e) })));
          }
        }),
      );

      // ChainSpec: chain name
      cleanups.push(
        transport.handleRequest('remote_chain_spec_chain_name', async message => {
          if (!isEnumVariant(message, 'v1')) {
            return enumValue('v1', resultErr(new GenericError({ reason: UNSUPPORTED_MESSAGE_FORMAT_ERROR })));
          }
          const genesisHash = message.value;

          const entry = manager.getOrCreateChain(genesisHash);
          if (!entry) {
            return enumValue('v1', resultErr(new GenericError({ reason: 'Chain not supported' })));
          }

          try {
            const result = await manager.sendRequest(genesisHash, 'chainSpec_v1_chainName', []);
            manager.releaseChain(genesisHash);
            return enumValue('v1', resultOk(result as string));
          } catch (e) {
            manager.releaseChain(genesisHash);
            return enumValue('v1', resultErr(new GenericError({ reason: String(e) })));
          }
        }),
      );

      // ChainSpec: properties
      cleanups.push(
        transport.handleRequest('remote_chain_spec_properties', async message => {
          if (!isEnumVariant(message, 'v1')) {
            return enumValue('v1', resultErr(new GenericError({ reason: UNSUPPORTED_MESSAGE_FORMAT_ERROR })));
          }
          const genesisHash = message.value;

          const entry = manager.getOrCreateChain(genesisHash);
          if (!entry) {
            return enumValue('v1', resultErr(new GenericError({ reason: 'Chain not supported' })));
          }

          try {
            const result = await manager.sendRequest(genesisHash, 'chainSpec_v1_properties', []);
            manager.releaseChain(genesisHash);
            return enumValue('v1', resultOk(typeof result === 'string' ? result : JSON.stringify(result)));
          } catch (e) {
            manager.releaseChain(genesisHash);
            return enumValue('v1', resultErr(new GenericError({ reason: String(e) })));
          }
        }),
      );

      // Transaction broadcast
      cleanups.push(
        transport.handleRequest('remote_chain_transaction_broadcast', async message => {
          if (!isEnumVariant(message, 'v1')) {
            return enumValue('v1', resultErr(new GenericError({ reason: UNSUPPORTED_MESSAGE_FORMAT_ERROR })));
          }
          const { genesisHash, transaction } = message.value;

          const permissionResponse = await handleRemotePermissionSlot.call(
            enumValue('v1', enumValue('ChainSubmit', undefined)),
          );
          const permissionGranted =
            isEnumVariant(permissionResponse, 'v1') &&
            permissionResponse.value.success === true &&
            permissionResponse.value.value === true;

          if (!permissionGranted) {
            return enumValue('v1', resultErr(new GenericError({ reason: 'Permission denied' })));
          }

          const entry = manager.getOrCreateChain(genesisHash);
          if (!entry) {
            return enumValue('v1', resultErr(new GenericError({ reason: 'Chain not supported' })));
          }

          try {
            const operationId = await manager.sendRequest<string | null>(genesisHash, 'transaction_v1_broadcast', [
              transaction,
            ]);
            // `transaction_v1_broadcast` is not one-shot: the node re-broadcasts
            // only while the connection lives, until a matching
            // `transaction_v1_stop`. Keep the chain ref acquired above by
            // recording the live operation; the stop handler releases it.
            // A null operationId means nothing to stop, so release now.
            if (operationId) {
              liveBroadcasts.add(`${genesisHash}:${operationId}`);
            } else {
              manager.releaseChain(genesisHash);
            }
            return enumValue('v1', resultOk(operationId));
          } catch (e) {
            manager.releaseChain(genesisHash);
            return enumValue('v1', resultErr(new GenericError({ reason: String(e) })));
          }
        }),
      );

      // Transaction stop
      cleanups.push(
        transport.handleRequest('remote_chain_transaction_stop', async message => {
          if (!isEnumVariant(message, 'v1')) {
            return enumValue('v1', resultErr(new GenericError({ reason: UNSUPPORTED_MESSAGE_FORMAT_ERROR })));
          }
          const { genesisHash, operationId } = message.value;

          // Only a stop matching a live broadcast releases the ref that broadcast
          // holds (over its still-open connection). Duplicate or unknown stops
          // are no-op successes, so refCount can't be driven below what the live
          // broadcasts justify.
          if (!liveBroadcasts.delete(`${genesisHash}:${operationId}`)) {
            return enumValue('v1', resultOk(undefined));
          }

          try {
            await manager.sendRequest(genesisHash, 'transaction_v1_stop', [operationId]);
            return enumValue('v1', resultOk(undefined));
          } catch (e) {
            return enumValue('v1', resultErr(new GenericError({ reason: String(e) })));
          } finally {
            manager.releaseChain(genesisHash);
          }
        }),
      );

      let disposed = false;

      const dispose = () => {
        if (disposed) return;
        disposed = true;
        unsubscribeDestroy();
        for (const fn of cleanups) fn();
        manager.dispose();
      };

      const unsubscribeDestroy = transport.onDestroy(dispose);

      return dispose;
    },

    isReady() {
      return transport.isReady();
    },

    subscribeProductConnectionStatus(callback: (connectionStatus: ConnectionStatus) => void) {
      // this specific order exists because container should report all connection statuses including "disconnected",
      // which immediately got changed to "connecting" after init() call.
      const unsubscribe = transport.onConnectionStatusChange(callback);
      init();
      return unsubscribe;
    },

    dispose() {
      transport.destroy();
    },

    onDebugMessage(callback) {
      return transport.onDebugMessage(({ direction, requestId, payload }) => {
        callback({ direction, productId, requestId, payload });
      });
    },
  };
}
