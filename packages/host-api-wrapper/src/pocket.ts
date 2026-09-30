import type { CodecType, PocketCard as PocketCardCodec, Subscription, Transport } from '@novasamatech/host-api';
import { createHostApi, enumValue } from '@novasamatech/host-api';

import type { GenericInterrupt } from './helpers.js';
import { genericInterrupt, resultToPromise, unwrapVersionedResult, unwrapVersionedSubscription } from './helpers.js';
import { sandboxTransport } from './sandboxTransport.js';

/**
 * One of this product's cards in the host's Pocket collection. `cardId` is the
 * label the product declared in its manifest; a `privileged` card was placed by
 * the host itself and can be removed by neither the user nor the product.
 *
 * A card's face is drawn by the product through the renderer, with a
 * `PocketCard` render context (see `createProductRenderer`).
 */
export type PocketCard = CodecType<typeof PocketCardCodec>;

export const createPocket = (transport: Transport = sandboxTransport) => {
  const version = 'v1' as const;
  const hostApi = createHostApi(transport);

  return {
    // Emits this product's whole card set right away, then again after every change.
    subscribeCards(callback: (cards: PocketCard[]) => void): Subscription<GenericInterrupt | undefined> {
      return unwrapVersionedSubscription(
        hostApi.pocket.listSubscribe(enumValue(version, undefined), payload => {
          if (payload.tag === version) callback(payload.value.cards);
        }),
        genericInterrupt,
      );
    },

    // Remove one of this product's cards. Removing a card that is not present
    // resolves; a privileged card rejects with `PocketRemoveCardErr.Privileged`.
    async removeCard(cardId: string): Promise<void> {
      return resultToPromise(unwrapVersionedResult(version, hostApi.pocket.removeCard(enumValue(version, { cardId }))));
    },
  };
};

export const hostPocket = createPocket();
