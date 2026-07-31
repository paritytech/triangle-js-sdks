import type { Codec } from 'scale-ts';

import type { ReadableEvent } from './codec/decoder.js';
import type { Message, RequestMessage, RequestPayload } from './types.js';

function decode<T>(payload: Uint8Array, codec: Codec<T>): RequestPayload<T> {
  try {
    return { status: 'parsed', value: codec.dec(payload) };
  } catch {
    return { status: 'failed', value: payload };
  }
}

export function toMessage<T>(event: ReadableEvent, codec: Codec<T>): Message<T>[] {
  switch (event.tag) {
    case 'request': {
      return event.messages.map<RequestMessage<T>>((payload, index) => {
        return {
          type: 'request',
          localId: `${event.requestId}-${index.toString()}`,
          requestId: event.requestId,
          payload: decode(payload, codec),
        };
      });
    }
    case 'response':
      return [
        {
          type: 'response',
          localId: event.requestId,
          requestId: event.requestId,
          responseCode: event.responseCode,
        },
      ];
  }
}
