import { Bytes } from '@novasamatech/scale';
import { AccountIdCodec } from '@novasamatech/statement-store';
import { Option, Struct, str } from 'scale-ts';

export const Contact = Struct({
  username: str,
  accountId: AccountIdCodec,
  publicKey: Bytes(),
  pin: Option(str),
  pushId: Option(str),
  pushToken: Option(Bytes()),
  lastOwnToken: Option(Bytes()),
});
