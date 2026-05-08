import { Enum } from '@novasamatech/scale';
import { Bytes, Option, Struct, str } from 'scale-ts';

import { EncrPubKey, SsPubKey } from '../../../crypto.js';

const optStr = Option(str);

export const HandshakeData = Enum({
  v1: Struct({
    ssPublicKey: SsPubKey,
    encrPublicKey: EncrPubKey,
    metadata: str,
    hostVersion: optStr,
    osType: optStr,
    osVersion: optStr,
  }),
});

export const HandshakeResponsePayload = Enum({
  v1: Struct({ encrypted: Bytes(), tmpKey: Bytes(65) }),
});

export const HandshakeResponseSensitiveData = Struct({
  sharedSecretDerivationKey: Bytes(65),
  rootUserAccountId: Bytes(32),
  identityAccountId: Bytes(32),
});
