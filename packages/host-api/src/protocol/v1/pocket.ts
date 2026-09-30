import { ErrEnum } from '@novasamatech/scale';
import { Struct, Vector, _void, bool, str } from 'scale-ts';

import { GenericErr, GenericError } from '../commonCodecs.js';

/** One of the calling product's Pocket cards. */
export const PocketCard = Struct({
  /** Card label declared by the product, unique within the product. */
  cardId: str,
  /** Placed by the host itself; removable by neither the user nor the product. */
  privileged: bool,
});

export const PocketRemoveCardErr = ErrEnum('PocketRemoveCardErr', {
  Privileged: [_void, 'Pocket: card is privileged'],
  Unknown: [GenericErr, 'Pocket: unknown error'],
});

// pocket.listSubscribe — the whole card set on subscribe and after every change.

export const PocketListSubscribeV1_start = _void;
export const PocketListSubscribeV1_receive = Struct({ cards: Vector(PocketCard) });
export const PocketListSubscribeV1_interrupt = GenericError;

// pocket.removeCard — removing a card that is not present succeeds.

export const PocketRemoveCardV1_request = Struct({ cardId: str });
export const PocketRemoveCardV1_response = _void;
export const PocketRemoveCardV1_error = PocketRemoveCardErr;
