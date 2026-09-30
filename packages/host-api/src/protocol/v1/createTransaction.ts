import { Bytes, ErrEnum } from '@novasamatech/scale';
import type { Codec } from 'scale-ts';
import { Struct, Vector, _void, str, u8 } from 'scale-ts';

import { GenericErr, GenesisHash } from '../commonCodecs.js';

import { AccountId, ProductAccountId } from './accounts.js';
import { ContactHandle } from './contacts.js';

/**
 * createTransaction implementation
 * @see https://github.com/polkadot-js/api/issues/6213
 * Since specification is aimed to cover both online and offline signers we dropped some field that are not related
 */

export const CreateTransactionErr = ErrEnum('CreateTransactionErr', {
  FailedToDecode: [_void, 'Failed to decode'],
  Rejected: [_void, 'Rejected'],
  // Unsupported payload version
  // Failed to infer missing extensions, some extension is unsupported, etc.
  NotSupported: [str, 'Not Supported'],
  PermissionDenied: [_void, 'Permission denied'],
  Unknown: [GenericErr, 'Unknown error'],
  // `contacts` named a handle the host cannot resolve.
  UnknownContact: [_void, 'Unknown contact'],
});

export const TxPayloadExtensionV1 = Struct({
  /** Identifier as defined in metadata (e.g., "CheckSpecVersion", "ChargeAssetTxPayment"). */
  id: str,
  /**
   * Explicit "extra" to sign (goes into the extrinsic body).
   * SCALE-encoded per the extension's "extra" type as defined in the metadata.
   */
  extra: Bytes(),
  /**
   * "Implicit" data to sign (known by the chain, not included into the extrinsic body).
   * SCALE-encoded per the extension's "additionalSigned" type as defined in the metadata.
   */
  additionalSigned: Bytes(),
});

function txPayloadFieldsV1<Signer>(signer: Codec<Signer>) {
  return {
    signer,
    /**
     * Chain identifier where transaction will be executed
     */
    genesisHash: GenesisHash,
    /**
     * SCALE-encoded Call (module indicator + function indicator + params).
     */
    callData: Bytes(),
    /**
     * Transaction extensions supplied by the caller (order irrelevant).
     * The consumer SHOULD provide every extension that is relevant to them.
     * The implementer MAY infer missing ones.
     */
    extensions: Vector(TxPayloadExtensionV1),
    /**
     * Transaction Extension Version.
     * - For Extrinsic V4 MUST be 0.
     * - For Extrinsic V5, set to any version supported by the runtime.
     * The implementer:
     *  - MUST use this field to determine the required extensions for creating the extrinsic.
     *  - MAY use this field to infer missing extensions that the implementer could know how to handle.
     */
    txExtVersion: u8,
  };
}

// transaction in the context of a host api account model

export const ProductAccountTransaction = Struct({
  ...txPayloadFieldsV1(ProductAccountId),
  /**
   * Contact handles (from `contacts.pick`) that `callData` names. The host
   * replaces them with the accounts they resolve to before anything is signed
   * or shown, and refuses with `CreateTransactionErr.UnknownContact` when it
   * cannot resolve one. A call naming nobody leaves this empty.
   */
  contacts: Vector(ContactHandle),
});
export const LegacyTransaction = Struct(txPayloadFieldsV1(AccountId));

export const CreateTransactionV1_request = ProductAccountTransaction;
export const CreateTransactionV1_response = Bytes();
export const CreateTransactionV1_error = CreateTransactionErr;

export const CreateTransactionWithLegacyAccountV1_request = LegacyTransaction;
export const CreateTransactionWithLegacyAccountV1_response = Bytes();
export const CreateTransactionWithLegacyAccountV1_error = CreateTransactionErr;
