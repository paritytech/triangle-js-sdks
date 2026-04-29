import { khash } from '@novasamatech/statement-store';
import { mergeUint8 } from '@polkadot-api/utils';
import { describe, expect, it } from 'vitest';

import { computePairingChannel, computePairingTopic } from '../src/sso/auth/v2/topic.js';

const statementAccountId = new Uint8Array(32).fill(0xa1);
const encryptionPublicKey = new Uint8Array(65).fill(0x04);

describe('computePairingTopic', () => {
  it('matches spec: khash(statementAccountId, encryptionPublicKey || "topic")', () => {
    const expected = khash(statementAccountId, mergeUint8([encryptionPublicKey, new TextEncoder().encode('topic')]));
    expect(computePairingTopic(statementAccountId, encryptionPublicKey)).toEqual(expected);
  });

  it('produces a 32-byte output', () => {
    expect(computePairingTopic(statementAccountId, encryptionPublicKey).length).toBe(32);
  });

  it('is deterministic', () => {
    const a = computePairingTopic(statementAccountId, encryptionPublicKey);
    const b = computePairingTopic(statementAccountId, encryptionPublicKey);
    expect(a).toEqual(b);
  });

  it('differs when the device account id differs', () => {
    const a = computePairingTopic(statementAccountId, encryptionPublicKey);
    const b = computePairingTopic(new Uint8Array(32).fill(0xa2), encryptionPublicKey);
    expect(a).not.toEqual(b);
  });

  it('differs when the encryption public key differs', () => {
    const a = computePairingTopic(statementAccountId, encryptionPublicKey);
    const b = computePairingTopic(statementAccountId, new Uint8Array(65).fill(0x05));
    expect(a).not.toEqual(b);
  });
});

describe('computePairingChannel', () => {
  it('matches spec: khash(statementAccountId, encryptionPublicKey || "channel")', () => {
    const expected = khash(statementAccountId, mergeUint8([encryptionPublicKey, new TextEncoder().encode('channel')]));
    expect(computePairingChannel(statementAccountId, encryptionPublicKey)).toEqual(expected);
  });

  it('differs from the topic for the same device', () => {
    const topic = computePairingTopic(statementAccountId, encryptionPublicKey);
    const channel = computePairingChannel(statementAccountId, encryptionPublicKey);
    expect(topic).not.toEqual(channel);
  });
});
