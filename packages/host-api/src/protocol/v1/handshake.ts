import { ErrEnum } from '@novasamatech/scale';
import { Result, _void, u8 } from 'scale-ts';

import { GenericErr } from '../commonCodecs.js';

export const HandshakeErr = ErrEnum('HandshakeErr', {
  Timeout: [_void, 'Handshake: timeout'],
  UnsupportedProtocolVersion: [_void, 'Handshake: unsupported protocol version'],
  Unknown: [GenericErr, 'Handshake: unknown error'],
});

/**
 * HandshakeV1_request = 1 - JAM codec
 */
export const HandshakeV1_request = u8;
export const HandshakeV1_response = Result(_void, HandshakeErr);
