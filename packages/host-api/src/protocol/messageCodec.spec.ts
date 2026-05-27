import { describe, expect, it } from 'vitest';

import { MessagePayload } from './messageCodec.js';

describe('MessagePayload wire format', () => {
  // `host_payment_status_subscribe_receive` is variant index 129 — past the 127
  // boundary where the compact discriminant diverges from a single u8. A u8 enum
  // would write the tag as [129]; CompactEnum writes the 2-byte compact form
  // [128, 129]. This golden vector guards against an accidental variant reorder
  // or a revert to a u8 discriminant silently changing the wire format.
  it('encodes a >127 variant discriminant as 2 compact bytes', () => {
    const message = {
      tag: 'host_payment_status_subscribe_receive',
      value: { tag: 'v1', value: { tag: 'Processing', value: undefined } },
    } as const;

    const encoded = MessagePayload.enc(message);
    // [compact(129) = 128,129] [version v1 = 0] [PaymentStatus::Processing = 0]
    expect([...encoded]).toEqual([128, 129, 0, 0]);
    expect(MessagePayload.dec(encoded)).toEqual(message);
  });
});
