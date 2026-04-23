import { Result, Tuple, _void, str } from 'scale-ts';

import { GenericError, GenesisHash } from '../commonCodecs.js';

export const JsonRpcMessageSendV1_request = Tuple(GenesisHash, str);
export const JsonRpcMessageSendV1_response = Result(_void, GenericError);

export const JsonRpcMessageSubscribeV1_start = GenesisHash;
export const JsonRpcMessageSubscribeV1_receive = str;
export const JsonRpcMessageSubscribeV1_interrupt = _void;
