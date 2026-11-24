import { describe, expect, it } from 'vitest';

import { ChatMessage } from './codec/message.js';
import { keepSingleSeenMessage } from './seen.js';

const seen = (id: string, messageId: string, timestamp: bigint) =>
  ChatMessage.enc({
    messageId: id,
    timestamp: 1_000n,
    versioned: { tag: 'v1', value: { tag: 'seen', value: { messageId, timestamp } } },
  });

const text = (id: string) =>
  ChatMessage.enc({ messageId: id, timestamp: 1_000n, versioned: { tag: 'v1', value: { tag: 'text', value: 'hi' } } });

describe('keepSingleSeenMessage', () => {
  it('treats only seen receipts as replaceable', () => {
    expect(keepSingleSeenMessage.isReplaceable(seen('s1', 'm1', 5n))).toBe(true);
    expect(keepSingleSeenMessage.isReplaceable(text('t1'))).toBe(false);
    expect(keepSingleSeenMessage.isReplaceable(new Uint8Array([0xff]))).toBe(false);
  });

  // Each receipt is its own message with a fresh id; only the SeenContent decides.
  it('drops a receipt with the same SeenContent as the pending one', () => {
    expect(keepSingleSeenMessage.decide(seen('s2', 'm1', 5n), seen('s1', 'm1', 5n))).toBe('dropNew');
  });

  it('replaces a pending receipt with different SeenContent', () => {
    expect(keepSingleSeenMessage.decide(seen('s2', 'm2', 6n), seen('s1', 'm1', 5n))).toBe('replacePending');
    expect(keepSingleSeenMessage.decide(seen('s2', 'm1', 6n), seen('s1', 'm1', 5n))).toBe('replacePending');
  });

  it('keeps a pending message that is not a receipt', () => {
    expect(keepSingleSeenMessage.decide(seen('s1', 'm1', 5n), text('t1'))).toBe('keepBoth');
  });
});
