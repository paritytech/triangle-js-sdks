import { Bytes, ErrEnum } from '@novasamatech/scale';
import { Option, Struct, Tuple, _void, str } from 'scale-ts';

import { CallResult } from '../callError.js';
import { GenericErr } from '../commonCodecs.js';

// common structures

export const StorageErr = ErrEnum('StorageErr', {
  Full: [_void, 'Storage is full'],
  Unknown: [GenericErr, 'Unknown storage error'],
});

export const StorageKey = str;
export const StorageValue = Bytes();

// actions

export const StorageReadV1_request = StorageKey;
export const StorageReadV1_response = CallResult(Option(StorageValue), StorageErr);

export const StorageWriteV1_request = Tuple(StorageKey, StorageValue);
export const StorageWriteV1_response = CallResult(_void, StorageErr);

export const StorageClearV1_request = StorageKey;
export const StorageClearV1_response = CallResult(_void, StorageErr);

// Emits the current value first, then one item per later write or clear of the
// key. `None` represents a cleared or absent key.
export const StorageSubscribeV1_start = Struct({ key: StorageKey });
export const StorageSubscribeV1_receive = Struct({ value: Option(StorageValue) });
export const StorageSubscribeV1_interrupt = _void;
