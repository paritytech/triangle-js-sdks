import { Bytes, ErrEnum } from '@novasamatech/scale';
import { Option, Struct, Tuple, _void, str } from 'scale-ts';

import { GenericErr, GenericError } from '../commonCodecs.js';

// common structures

export const StorageErr = ErrEnum('StorageErr', {
  Full: [_void, 'Storage is full'],
  Unknown: [GenericErr, 'Unknown storage error'],
});

export const StorageKey = str;
export const StorageValue = Bytes();

// actions

export const StorageReadV1_request = StorageKey;
export const StorageReadV1_response = Option(StorageValue);
export const StorageReadV1_error = StorageErr;

// v2: a read may address another product's storage, which succeeds only when
// that product's manifest grants the caller the `storage` scope.

export const StorageReadV2Err = ErrEnum('StorageReadV2Err', {
  Full: [_void, 'Storage is full'],
  // One variant for every refusal reason (unknown product, no manifest, no
  // grant) so the call cannot probe which products exist or hold data.
  AccessNotGranted: [_void, 'The owning product grants no read access to its storage'],
  Unknown: [GenericErr, 'Unknown storage error'],
});

export const StorageReadV2_request = Struct({
  /** Product whose storage is read; `undefined` (or the caller's own id) reads the caller's own. */
  product: Option(str),
  key: StorageKey,
});
export const StorageReadV2_response = Option(StorageValue);
export const StorageReadV2_error = StorageReadV2Err;

export const StorageWriteV1_request = Tuple(StorageKey, StorageValue);
export const StorageWriteV1_response = _void;
export const StorageWriteV1_error = StorageErr;

export const StorageClearV1_request = StorageKey;
export const StorageClearV1_response = _void;
export const StorageClearV1_error = StorageErr;

// Emits the current value first, then one item per later write or clear of the
// key. `None` represents a cleared or absent key.
export const StorageSubscribeV1_start = Struct({ key: StorageKey });
export const StorageSubscribeV1_receive = Struct({ value: Option(StorageValue) });
export const StorageSubscribeV1_interrupt = GenericError;
