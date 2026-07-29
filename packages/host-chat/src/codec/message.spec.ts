import { describe, expect, it } from 'vitest';

import { DeviceInfoContent } from './message.js';

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
