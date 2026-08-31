import { Status } from '@novasamatech/scale';
import { Struct, _void, str } from 'scale-ts';

import { CallResult } from '../callError.js';
import { GenericError } from '../commonCodecs.js';

// Platform category a host runs on. Variant order is the wire encoding — keep
// it aligned with truapi `HostPlatform`.
export const HostPlatform = Status('Web', 'Android', 'Ios', 'Desktop', 'Cli', 'Unknown');

// Identity and version of the host currently running the product.
export const HostInfo = Struct({
  platform: HostPlatform,
  name: str,
  version: str,
});

export const HostInfoV1_request = _void;
export const HostInfoV1_response = CallResult(HostInfo, GenericError);

// Product context bound to the current host runtime.
export const ProductContext = Struct({
  productId: str,
});

export const GetProductContextV1_request = _void;
export const GetProductContextV1_response = CallResult(ProductContext, GenericError);
