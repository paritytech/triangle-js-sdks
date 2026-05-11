import { ErrEnum } from '@novasamatech/scale';
import type { Codec } from 'scale-ts';
import { Bytes, Result, Struct, Vector, _void, str, u8 } from 'scale-ts';

import { GenericErr } from '../commonCodecs.js';

import { AccountId, ProductAccountId } from './accounts.js';

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

function GenericTxPayloadV1<Signer>(signer: Codec<Signer>) {
  return Struct({
    signer,
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
  });
}

// transaction in the context of a host api account model

export const ProductAccountTransaction = GenericTxPayloadV1(ProductAccountId);
export const LegacyTransaction = GenericTxPayloadV1(AccountId);

export const CreateTransactionV1_request = ProductAccountTransaction;
export const CreateTransactionV1_response = Result(Bytes(), CreateTransactionErr);

export const CreateTransactionWithLegacyAccountV1_request = LegacyTransaction;
export const CreateTransactionWithLegacyAccountV1_response = Result(Bytes(), CreateTransactionErr);
