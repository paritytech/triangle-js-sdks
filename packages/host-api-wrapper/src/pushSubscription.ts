import type { CodecType, PushRule as PushRuleCodec, Transport } from '@novasamatech/host-api';
import { createHostApi, enumValue } from '@novasamatech/host-api';

import { resultToPromise, unwrapVersionedResult } from './helpers.js';
import { sandboxTransport } from './sandboxTransport.js';

export type PushRule = CodecType<typeof PushRuleCodec>;

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
  };
};

export const pushSubscriptionManager = createPushSubscriptionManager();
