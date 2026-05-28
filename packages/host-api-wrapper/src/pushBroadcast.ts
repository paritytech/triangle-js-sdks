import type {
  CodecType,
  PushBroadcastContent as PushBroadcastContentCodec,
  Topic as TopicCodec,
  Transport,
} from '@novasamatech/host-api';
import { createHostApi, enumValue } from '@novasamatech/host-api';

import { resultToPromise, unwrapVersionedResult } from './helpers.js';
import { sandboxTransport } from './sandboxTransport.js';

export type Topic = CodecType<typeof TopicCodec>;
export type PushBroadcastContent = CodecType<typeof PushBroadcastContentCodec>;

export type PushBroadcastInput = {
  topics: Topic[];
  content: PushBroadcastContent;
};

export type PushBroadcastResult = {
  /** Blake2b-256 of the broadcast, for dedup and audit. */
  messageHash: Uint8Array;
};

/**
 * Interim publish path. The host sets `signer` to the calling product's
 * identity, so it is absent from the request. Replaced once Statement Store
 * 1-to-many encryption ships.
 */
export const createPushBroadcaster = (transport: Transport = sandboxTransport) => {
  const supportedVersion = 'v1';
  const hostApi = createHostApi(transport);

  return {
    broadcast(input: PushBroadcastInput): Promise<PushBroadcastResult> {
      return resultToPromise(
        unwrapVersionedResult(supportedVersion, hostApi.pushBroadcast(enumValue(supportedVersion, input))),
      );
    },
  };
};

export const pushBroadcaster = createPushBroadcaster();
