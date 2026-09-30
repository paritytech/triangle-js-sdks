import type { CodecType, ContactHandle as ContactHandleCodec, Transport } from '@novasamatech/host-api';
import { createHostApi, enumValue } from '@novasamatech/host-api';

import { resultToPromise, unwrapVersionedResult } from './helpers.js';
import { sandboxTransport } from './sandboxTransport.js';

/**
 * Opaque, product-scoped handle to a contact the user picked. Not an address:
 * it resolves to an account only inside a `createTransaction` that lists it in
 * `contacts`.
 */
export type ContactHandle = CodecType<typeof ContactHandleCodec>;

/**
 * How a contact pick ended. Neither a dismissal nor an empty contact list is an
 * error: a dismissal is worth retrying, an empty list is not.
 */
export type ContactPickOutcome =
  /** The user chose someone. `handle` is stable for this person across products and hosts. */
  | { type: 'picked'; handle: ContactHandle }
  /** The user closed the picker without choosing. */
  | { type: 'dismissed' }
  /** The user has no contacts, so no picker was shown. */
  | { type: 'noContacts' };

export const createContacts = (transport: Transport = sandboxTransport) => {
  const version = 'v1' as const;
  const hostApi = createHostApi(transport);

  return {
    /**
     * Opens the host's contact picker and resolves with how it ended.
     *
     * The product never sees the contact list, only the handle of the person
     * the user picked, so there is no permission to request. The handle is not
     * an address and cannot be turned into one: to pay the person, put
     * `handle.bytes` where the recipient account goes in the call and list the
     * handle in the signer's `contacts` (see
     * `accounts.getProductAccountSigner(account, 'createTransaction', { contacts })`).
     * The host replaces it with their account before anything is shown or signed.
     *
     * Rejects with `ContactsPickErr` (`NotConnected` without a session).
     */
    async pick(): Promise<ContactPickOutcome> {
      const { outcome } = await resultToPromise(
        unwrapVersionedResult(version, hostApi.contacts.pick(enumValue(version, {}))),
      );

      switch (outcome.tag) {
        case 'Picked':
          return { type: 'picked', handle: outcome.value.handle };
        case 'Dismissed':
          return { type: 'dismissed' };
        case 'NoContacts':
          return { type: 'noContacts' };
        default:
          // A new ContactPickOutcome variant must be mirrored into the type above.
          return outcome satisfies never;
      }
    },
  };
};

export const hostContacts = createContacts();
