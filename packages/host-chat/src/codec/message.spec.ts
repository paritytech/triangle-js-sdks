import { fromHex, toHex } from '@novasamatech/scale';
import { Vector } from 'scale-ts';
import { describe, expect, it } from 'vitest';

import { ChatMessage, DeviceInfoContent, MessageContent } from './message.js';

describe('DeviceInfoContent', () => {
  it('round-trips a 32-byte X25519 encryption public key', () => {
    const info = {
      statementAccountId: new Uint8Array(32).fill(0xa1),
      encryptionPublicKey: new Uint8Array(32).fill(0x04),
    };

    expect(DeviceInfoContent.dec(DeviceInfoContent.enc(info))).toEqual(info);
  });

  it('encodes to a fixed 64 bytes (32-byte accountId + 32-byte X25519 key)', () => {
    const info = {
      statementAccountId: new Uint8Array(32).fill(0xa1),
      encryptionPublicKey: new Uint8Array(32).fill(0x04),
    };

    expect(DeviceInfoContent.enc(info).length).toBe(64);
  });
});

// Frozen cross-platform vectors, copied byte-for-byte from Android's conformance tests
// (host-rust-core, SeenScaleConformanceTest / CompactionScaleConformanceTest).
const SEEN_VECTOR =
  '0x16' + '90' + '30663866616435622d643963622d343639662d613136352d373038363737323839353065' + 'a0217b6800000000';

const COMPACTION_COMMIT_VECTOR =
  '0x13' +
  '80' +
  '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f' +
  '80' +
  '202122232425262728292a2b2c2d2e2f303132333435363738393a3b3c3d3e3f' +
  '00' +
  '587773733a2f2f686f702e6578616d706c652f6e6f6465';

const seen = {
  tag: 'seen' as const,
  value: { messageId: '0f8fad5b-d9cb-469f-a165-70867728950e', timestamp: 1_752_900_000n },
};

const compactionCommit = {
  tag: 'compactedMessages' as const,
  value: {
    claimIdentifier: Uint8Array.from({ length: 32 }, (_, i) => i),
    claimTicket: Uint8Array.from({ length: 32 }, (_, i) => i + 0x20),
    node: { tag: 'wssUrl' as const, value: { url: 'wss://hop.example/node' } },
  },
};

describe('MessageContent.seen (index 22)', () => {
  it('encodes to the Android frozen vector', () => {
    expect(toHex(MessageContent.enc(seen))).toBe(SEEN_VECTOR);
  });

  it('decodes the Android frozen vector', () => {
    expect(MessageContent.dec(fromHex(SEEN_VECTOR))).toEqual(seen);
  });

  it('round-trips inside a ChatMessage', () => {
    const message = { messageId: 'm-1', timestamp: 1_752_900_123_456n, versioned: { tag: 'v1' as const, value: seen } };

    expect(ChatMessage.dec(ChatMessage.enc(message))).toEqual(message);
  });
});

describe('MessageContent.compactedMessages (index 19)', () => {
  it('encodes to the Android frozen vector', () => {
    expect(toHex(MessageContent.enc(compactionCommit))).toBe(COMPACTION_COMMIT_VECTOR);
  });

  it('decodes the Android frozen vector', () => {
    expect(MessageContent.dec(fromHex(COMPACTION_COMMIT_VECTOR))).toEqual(compactionCommit);
  });

  // The old `_void` placeholder decoded a commit as an empty variant and left its payload
  // unread, so whatever followed it in the same buffer was decoded from the wrong offset.
  it('consumes its payload, so a following entry still decodes', () => {
    const text = { tag: 'text' as const, value: 'after the commit' };
    const entries = Vector(MessageContent);

    expect(entries.dec(entries.enc([compactionCommit, text]))).toEqual([compactionCommit, text]);
  });
});
