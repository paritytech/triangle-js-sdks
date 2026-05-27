import type { EnumCodec } from '@novasamatech/scale';
import { Enum } from '@novasamatech/scale';
import type { Codec, CodecType } from 'scale-ts';
import { Struct, _void, str } from 'scale-ts';

import type { HostApiProtocol, VersionedProtocolRequest, VersionedProtocolSubscription } from './impl.js';
import { hostApiProtocol } from './impl.js';

type UnionToIntersection<U> = (U extends any ? (k: U) => void : never) extends (k: infer I) => void ? I : never;

type InferRequest<Method extends string, R extends VersionedProtocolRequest<any>> = Record<
  `${Method}_request`,
  R['request']
> &
  Record<`${Method}_response`, R['response']>;
type InferSubscription<Method extends string, R extends VersionedProtocolSubscription<any>> = Record<
  `${Method}_start`,
  R['start']
> &
  Record<`${Method}_receive`, R['receive']> &
  Record<`${Method}_interrupt`, R['interrupt']> &
  Record<`${Method}_stop`, Codec<undefined>>;

type InferHostApiMethod<Method extends string, Payload> =
  Payload extends VersionedProtocolRequest<any>
    ? InferRequest<Method, Payload>
    : Payload extends VersionedProtocolSubscription<any>
      ? InferSubscription<Method, Payload>
      : Codec<undefined>;

type HostApiPayloadFields = UnionToIntersection<
  {
    [Method in keyof HostApiProtocol]: InferHostApiMethod<Method, HostApiProtocol[Method]>;
  }[keyof HostApiProtocol]
>;

const createPayload = (hostApi: HostApiProtocol): EnumCodec<HostApiPayloadFields> => {
  const fields: Record<string, Codec<any>> = {};
  // Serialization index per field, kept positionally in lockstep with `fields`
  // so the on-wire ABI is pinned by each method's explicit base index rather
  // than by object iteration order.
  const indexes: number[] = [];

  for (const [method, payload] of Object.entries(hostApi)) {
    if (payload.method === 'request') {
      fields[`${method}_request`] = payload.request;
      indexes.push(payload.index);
      fields[`${method}_response`] = payload.response;
      indexes.push(payload.index + 1);
    }
    if (payload.method === 'subscribe') {
      fields[`${method}_start`] = payload.start;
      indexes.push(payload.index);
      fields[`${method}_stop`] = _void;
      indexes.push(payload.index + 1);
      fields[`${method}_interrupt`] = payload.interrupt;
      indexes.push(payload.index + 2);
      fields[`${method}_receive`] = payload.receive;
      indexes.push(payload.index + 3);
    }
  }

  return Enum(fields as HostApiPayloadFields, indexes);
};

export type MessagePayloadSchema = CodecType<EnumCodec<HostApiPayloadFields>>;

export const MessagePayload = createPayload(hostApiProtocol);

export const Message = Struct({
  requestId: str,
  payload: MessagePayload,
});

export type MessageAction = MessagePayloadSchema['tag'];

export type PickMessagePayload<Action extends MessageAction> = Extract<MessagePayloadSchema, { tag: Action }>;

export type PickMessagePayloadValue<Action extends MessageAction> =
  PickMessagePayload<Action> extends never ? never : PickMessagePayload<Action>['value'];

export type ComposeMessageAction<
  Method extends string,
  Action extends string,
> = `${Method}_${Action}` extends MessageAction ? `${Method}_${Action}` : never;
