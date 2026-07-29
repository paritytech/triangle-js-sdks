import { describe, expect, it } from 'vitest';

import {
  CoinagePaymentContent,
  DataChannelAnswerContent,
  DataChannelClosedContent,
  DataChannelIceCandidateContent,
  DataChannelOfferContent,
  MessageContent,
} from './message.js';

describe('DataChannel content codecs', () => {
  it('DataChannelOfferContent round-trips with AUDIO_CALL purpose', () => {
    const original = {
      sdp: new TextEncoder().encode('v=0\r\no=- 4611...\r\n'),
      purpose: 'AUDIO_CALL' as const,
    };
    const decoded = DataChannelOfferContent.dec(DataChannelOfferContent.enc(original));
    expect(decoded.purpose).toBe('AUDIO_CALL');
    expect(decoded.sdp).toEqual(original.sdp);
  });

  it('DataChannelAnswerContent round-trips', () => {
    const original = { offerMessageId: 'offer-1', sdp: new Uint8Array([0xaa, 0xbb, 0xcc]) };
    const decoded = DataChannelAnswerContent.dec(DataChannelAnswerContent.enc(original));
    expect(decoded).toEqual(original);
  });

  it('DataChannelIceCandidateContent round-trips', () => {
    const original = { offerMessageId: 'offer-1', sdp: new Uint8Array([0xde, 0xad, 0xbe, 0xef]) };
    const decoded = DataChannelIceCandidateContent.dec(DataChannelIceCandidateContent.enc(original));
    expect(decoded).toEqual(original);
  });

  it('DataChannelClosedContent round-trips', () => {
    const original = { offerMessageId: 'offer-1' };
    const decoded = DataChannelClosedContent.dec(DataChannelClosedContent.enc(original));
    expect(decoded).toEqual(original);
  });
});

describe('CoinagePaymentContent', () => {
  it('round-trips with a small Balance and a couple of coin keys', () => {
    // scale-ts `compact` decodes to `number` for values ≤ 2^30 and `bigint`
    // for larger ones; normalise to BigInt before asserting.
    const original = {
      totalValue: 1_234_567,
      coinKeys: [new Uint8Array(32).fill(0x11), new Uint8Array(32).fill(0x22)],
    };
    const decoded = CoinagePaymentContent.dec(CoinagePaymentContent.enc(original));
    expect(BigInt(decoded.totalValue)).toBe(1_234_567n);
    expect(decoded.coinKeys).toHaveLength(2);
    expect(decoded.coinKeys[0]).toEqual(original.coinKeys[0]);
    expect(decoded.coinKeys[1]).toEqual(original.coinKeys[1]);
  });

  it('round-trips a large Balance (forces bigint path)', () => {
    const huge = 2n ** 100n;
    const original = {
      totalValue: huge,
      coinKeys: [new Uint8Array(32).fill(0x33)],
    };
    const decoded = CoinagePaymentContent.dec(CoinagePaymentContent.enc(original));
    expect(BigInt(decoded.totalValue)).toBe(huge);
  });

  it('round-trips with an empty coin-keys list', () => {
    const original = { totalValue: 0, coinKeys: [] };
    const decoded = CoinagePaymentContent.dec(CoinagePaymentContent.enc(original));
    expect(BigInt(decoded.totalValue)).toBe(0n);
    expect(decoded.coinKeys).toEqual([]);
  });
});

describe('MessageContent enum discriminants', () => {
  it('coinagePayment lands on discriminant 16 and round-trips inside MessageContent', () => {
    const value = {
      tag: 'coinagePayment' as const,
      value: { totalValue: 42, coinKeys: [new Uint8Array(32).fill(0xab)] },
    };
    const encoded = MessageContent.enc(value);
    expect(encoded[0]).toBe(16);
    const decoded = MessageContent.dec(encoded);
    expect(decoded.tag).toBe('coinagePayment');
    if (decoded.tag !== 'coinagePayment') throw new Error('unreachable');
    expect(BigInt(decoded.value.totalValue)).toBe(42n);
    expect(decoded.value.coinKeys[0]).toEqual(value.value.coinKeys[0]);
  });

  it('dataChannelClosed lands on discriminant 11 and round-trips inside MessageContent', () => {
    const value = {
      tag: 'dataChannelClosed' as const,
      value: { offerMessageId: 'offer-x' },
    };
    const encoded = MessageContent.enc(value);
    expect(encoded[0]).toBe(11);
    const decoded = MessageContent.dec(encoded);
    expect(decoded.tag).toBe('dataChannelClosed');
    if (decoded.tag !== 'dataChannelClosed') throw new Error('unreachable');
    expect(decoded.value.offerMessageId).toBe('offer-x');
  });

  it('dataChannelOffer lands on discriminant 8 and round-trips inside MessageContent', () => {
    const value = {
      tag: 'dataChannelOffer' as const,
      value: { sdp: new Uint8Array([1, 2, 3]), purpose: 'VIDEO_CALL' as const },
    };
    const encoded = MessageContent.enc(value);
    expect(encoded[0]).toBe(8);
    const decoded = MessageContent.dec(encoded);
    if (decoded.tag !== 'dataChannelOffer') throw new Error('unreachable');
    expect(decoded.value.purpose).toBe('VIDEO_CALL');
    expect(decoded.value.sdp).toEqual(value.value.sdp);
  });
});
