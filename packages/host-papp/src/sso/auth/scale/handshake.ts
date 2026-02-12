import { Enum } from '@novasamatech/scale';
import { Bytes, Struct, Tuple, str } from 'scale-ts';

import { EncrPubKey, SsPubKey } from '../../../crypto.js';

export const HandshakeData = Enum({
  v1: Tuple(SsPubKey, EncrPubKey, str),
});

export const HandshakeResponsePayload = Enum({
  v1: Struct({ encrypted: Bytes(), tmpKey: Bytes(65) }),
});

export const HandshakeResponseSensitiveData = Tuple(Bytes(65), Bytes(32));
