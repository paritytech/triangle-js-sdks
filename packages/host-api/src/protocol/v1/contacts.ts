import { Bytes, Enum, ErrEnum } from '@novasamatech/scale';
import { Struct, _void } from 'scale-ts';

import { GenericErr } from '../commonCodecs.js';

/**
 * Opaque, product-scoped handle to a contact the user picked. It names the
 * contact to the host (e.g. as a `createTransaction` recipient) without
 * disclosing who the contact is.
 */
export const ContactHandle = Struct({ bytes: Bytes(32) });

export const ContactPickOutcome = Enum({
  Picked: Struct({ handle: ContactHandle }),
  Dismissed: _void,
  NoContacts: _void,
});

export const ContactsPickErr = ErrEnum('ContactsPickErr', {
  NotConnected: [_void, 'ContactsPick: not connected'],
  Unknown: [GenericErr, 'ContactsPick: unknown error'],
});

export const ContactsPickV1_request = Struct({});
export const ContactsPickV1_response = Struct({ outcome: ContactPickOutcome });
export const ContactsPickV1_error = ContactsPickErr;
