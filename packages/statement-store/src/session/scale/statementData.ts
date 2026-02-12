import { Bytes, Enum, Struct, Vector, enhanceCodec, str, u8 } from 'scale-ts';

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

export const StatementData = Enum({
  request: Request,
  response: Response,
});
