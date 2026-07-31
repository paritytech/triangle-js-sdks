import { Bytes } from '@novasamatech/scale';
import { Enum, Struct, Vector, enhanceCodec, str, u8 } from 'scale-ts';

export type ResponseStatus = 'success' | 'decryptionFailed' | 'decodingFailed' | 'unknown';

export const ResponseCode = enhanceCodec<number, ResponseStatus>(
  u8,
  error => {
    switch (error) {
      case 'success':
        return 0;
      case 'decryptionFailed':
        return 1;
      case 'decodingFailed':
        return 2;
      case 'unknown':
        return 255;
    }
  },
  code => {
    switch (code) {
      case 0:
        return 'success';
      case 1:
        return 'decryptionFailed';
      case 2:
        return 'decodingFailed';
      default:
        return 'unknown';
    }
  },
);

export const Request = Struct({
  requestId: str,
  data: Vector(Bytes()),
});

export const Response = Struct({
  requestId: str,
  responseCode: ResponseCode,
});

/**
 * One recipient device of a multi-device envelope. `encryptedKey` is the envelope's
 * one-shot symmetric key wrapped for this device (see `session/codec/envelope.ts`).
 *
 * `statementAccountId` is a FIXED 32-byte array, matching Android's `RequestDeviceInfo`
 * (paritytech/polkadot-app-android-v2#605) and desktop. Pre-#605 Android builds emit
 * `Vec<u8>` here and are not interoperable.
 */
export const RequestDeviceInfo = Struct({
  statementAccountId: Bytes(32),
  encryptedKey: Bytes(),
});

const MultiRequest = Struct({
  encryptedRequest: Bytes(),
  devicesInfo: Vector(RequestDeviceInfo),
});

const MultiResponse = Struct({
  encryptedResponse: Bytes(),
  devicesInfo: Vector(RequestDeviceInfo),
});

/**
 * Statement `data` payload, after the outer pairwise decryption.
 *
 * Variant indices are wire format — scale-ts assigns them by declaration order, so
 * entries may only be APPENDED, never reordered:
 *   0 request       — single-device (base-spec.md)
 *   1 response      — single-device
 *   2 multiRequest  — multi-device envelope (mds.md)
 *   3 multiResponse — multi-device envelope
 */
export const StatementData = Enum({
  request: Request,
  response: Response,
  multiRequest: MultiRequest,
  multiResponse: MultiResponse,
});
