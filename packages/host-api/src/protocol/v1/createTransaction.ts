import type { HexString } from '@novasamatech/scale';
import { Enum, ErrEnum, Hex, Nullable } from '@novasamatech/scale';
import type { CodecType } from 'scale-ts';
import { Bytes, Result, Struct, Tuple, Vector, _void, enhanceCodec, str, u32, u8 } from 'scale-ts';

import { GenericErr } from '../commonCodecs.js';

import { ProductAccountId } from './accounts.js';

/**
 * createTransaction implementation
 * @see https://github.com/polkadot-js/api/issues/6213
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
  id: str,
  extra: Hex(),
  additionalSigned: Hex(),
});

export const TxPayloadContextV1 = Struct({
  metadata: Hex(),
  tokenSymbol: str,
  tokenDecimals: u32,
  bestBlockHeight: u32,
});

export const TxPayloadV1 = Struct({
  signer: Nullable(str),
  callData: Hex(),
  extensions: Vector(TxPayloadExtensionV1),
  txExtVersion: u8,
  context: TxPayloadContextV1,
});

export const VersionedTxPayload = Enum({
  v1: TxPayloadV1,
});

export const VersionedPublicTxPayload = enhanceCodec<CodecType<typeof VersionedTxPayload>, TxPayloadV1Public>(
  VersionedTxPayload,
  v => {
    if (v.version !== 1) {
      throw new Error(`Unsupported transaction version: ${v}`);
    }

    return {
      tag: 'v1',
      value: v,
    };
  },
  v => {
    if (v.tag !== 'v1') {
      throw new Error(`Unsupported transaction version: ${v}`);
    }

    return {
      version: 1,
      ...v.value,
    };
  },
);

// transaction in the context of a host api account model

export const CreateTransactionV1_request = Tuple(ProductAccountId, VersionedPublicTxPayload);
export const CreateTransactionV1_response = Result(Bytes(), CreateTransactionErr);

export const CreateTransactionWithNonProductAccountV1_request = VersionedPublicTxPayload;
export const CreateTransactionWithNonProductAccountV1_response = Result(Bytes(), CreateTransactionErr);

// related types

export interface TxPayloadV1Public {
  /** Payload version. MUST be 1. */
  version: 1;

  /**
   * Signer selection hint. Allows the implementer to identify which private-key / scheme to use.
   * - Use a wallet-defined handle (e.g., address/SS58, account-name, etc). This identifier
   * was previously made available to the consumer.
   * - Set `null` to let the implementer pick the signer (or if the signer is implied).
   */
  signer: string | null;

  /**
   * SCALE-encoded Call (module indicator + function indicator + params).
   */
  callData: HexString;

  /**
   * Transaction extensions supplied by the caller (order irrelevant).
   * The consumer SHOULD provide every extension that is relevant to them.
   * The implementer MAY infer missing ones.
   */
  extensions: Array<{
    /** Identifier as defined in metadata (e.g., "CheckSpecVersion", "ChargeAssetTxPayment"). */
    id: string;

    /**
     * Explicit "extra" to sign (goes into the extrinsic body).
     * SCALE-encoded per the extension's "extra" type as defined in the metadata.
     */
    extra: HexString;

    /**
     * "Implicit" data to sign (known by the chain, not included into the extrinsic body).
     * SCALE-encoded per the extension's "additionalSigned" type as defined in the metadata.
     */
    additionalSigned: HexString;
  }>;

  /**
   * Transaction Extension Version.
   * - For Extrinsic V4 MUST be 0.
   * - For Extrinsic V5, set to any version supported by the runtime.
   * The implementer:
   *  - MUST use this field to determine the required extensions for creating the extrinsic.
   *  - MAY use this field to infer missing extensions that the implementer could know how to handle.
   */
  txExtVersion: number;

  /**
   * Context needed for decoding, display, and (optionally) inferring certain extensions.
   */
  context: {
    /**
     * RuntimeMetadataPrefixed blob (SCALE), starting with ASCII "meta" magic (`0x6d657461`),
     * then a metadata version (V14+). For V5+ versioned extensions, MUST provide V16+.
     */
    metadata: HexString;

    /**
     * Native token display info (used by some implementers), also needed to compute
     * the `CheckMetadataHash` value.
     */
    tokenSymbol: string;
    tokenDecimals: number;

    /**
     * Highest known block number to aid mortality UX.
     */
    bestBlockHeight: number;
  };
}
