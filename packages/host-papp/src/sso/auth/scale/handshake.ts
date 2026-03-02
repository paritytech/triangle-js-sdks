import { Enum } from '@novasamatech/scale';
import { Bytes, Option, Struct, Tuple, str } from 'scale-ts';

import { EncrPubKey, SsPubKey } from '../../../crypto.js';

const optStr = Option(str);

export const HandshakeData = Enum({
  v1: Tuple(SsPubKey, EncrPubKey, str, optStr, optStr, optStr),
});

export const HandshakeResponsePayload = Enum({
  v1: Struct({ encrypted: Bytes(), tmpKey: Bytes(65) }),
});

export const HandshakeResponseSensitiveData = Tuple(Bytes(65), Bytes(32));
