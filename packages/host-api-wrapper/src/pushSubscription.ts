import type {
  CodecType,
  PushBroadcastContent as PushBroadcastContentCodec,
  PushRule as PushRuleCodec,
  Topic as TopicCodec,
  Transport,
} from '@novasamatech/host-api';
import { createHostApi, enumValue } from '@novasamatech/host-api';

import { resultToPromise, unwrapVersionedResult } from './helpers.js';
import { sandboxTransport } from './sandboxTransport.js';

export type PushRule = CodecType<typeof PushRuleCodec>;
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

export const createPushSubscriptionManager = (transport: Transport = sandboxTransport) => {
  const supportedVersion = 'v1';
  const hostApi = createHostApi(transport);

  return {
    addRules(rules: PushRule[]): Promise<void> {
      return resultToPromise(
        unwrapVersionedResult(supportedVersion, hostApi.pushAddRules(enumValue(supportedVersion, { rules }))),
      );
    },

    removeRules(rules: PushRule[]): Promise<void> {
      return resultToPromise(
        unwrapVersionedResult(supportedVersion, hostApi.pushRemoveRules(enumValue(supportedVersion, { rules }))),
      );
    },

    async listRules(): Promise<PushRule[]> {
      const response = await resultToPromise(
        unwrapVersionedResult(supportedVersion, hostApi.pushListRules(enumValue(supportedVersion, undefined))),
      );
      return response.rules;
    },

    setRules(rules: PushRule[]): Promise<void> {
      return resultToPromise(
        unwrapVersionedResult(supportedVersion, hostApi.pushSetRules(enumValue(supportedVersion, { rules }))),
      );
    },

    /**
     * Interim publish path. The host sets `signer` to the calling product's
     * identity, so it is absent from the request. Replaced once Statement Store
     * 1-to-many encryption ships.
     */
    broadcast(input: PushBroadcastInput): Promise<PushBroadcastResult> {
      return resultToPromise(
        unwrapVersionedResult(supportedVersion, hostApi.pushBroadcast(enumValue(supportedVersion, input))),
      );
    },
  };
};

export const pushSubscriptionManager = createPushSubscriptionManager();
