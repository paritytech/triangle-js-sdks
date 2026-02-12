import type { Codec, CodecType } from 'scale-ts';

import type { StatementData } from './scale/statementData.js';
import type { Message, RequestMessage, RequestPayload } from './types.js';

export function toMessage<T>(statementData: CodecType<typeof StatementData>, codec: Codec<T>): Message<T>[] {
  switch (statementData.tag) {
    case 'request': {
      const decode = (payload: Uint8Array): RequestPayload<T> => {
        try {
          return { status: 'parsed', value: codec.dec(payload) };
        } catch {
          return { status: 'failed', value: payload };
        }
      };
      return statementData.value.data.map<RequestMessage<T>>((payload, index) => {
        return {
          type: 'request',
          localId: `${statementData.value.requestId}-${index.toString()}`,
          requestId: statementData.value.requestId,
          payload: decode(payload),
        };
      });
    }
    case 'response':
      return [
        {
          type: 'response',
          localId: statementData.value.requestId,
          requestId: statementData.value.requestId,
          responseCode: statementData.value.responseCode,
        },
      ];
  }
}
