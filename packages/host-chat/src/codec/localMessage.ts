import { Enum, Status } from '@novasamatech/scale';
import { AccountIdCodec } from '@novasamatech/statement-store';
import { Bytes, Struct, u64 } from 'scale-ts';

import { ChatMessage } from './message.js';

export const OutgoingStatus = Status('new', 'sent', 'delivered');
export const IncomingStatus = Status('new', 'seen');
export const LocalStatus = Enum({
  outgoing: OutgoingStatus,
  incoming: IncomingStatus,
});

export const LocalMessage = Struct({
  remote: Enum({
    message: ChatMessage,
    unsupported: Bytes(),
  }),
  peerId: AccountIdCodec,
  status: LocalStatus,
  order: u64,
});
