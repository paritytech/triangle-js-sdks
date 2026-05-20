import { describe, expect, it } from 'vitest';

import type { MetadataEntry } from '../src/sso/auth/scale/handshakeV2.js';
import {
  Device,
  EncryptedHandshakeResponseV1,
  EncryptedHandshakeResponseV2,
  HandshakeProposalV2,
  HandshakeResponseV1,
  HandshakeResponseV2,
  HandshakeStatusV2,
  HandshakeSuccessV2,
  IDENTITY_SIGNATURE_PAYLOAD_BYTES,
  MetadataKey,
  VersionedHandshakeProposal,
  VersionedHandshakeResponse,
} from '../src/sso/auth/scale/handshakeV2.js';

const makeDevice = () => ({
  statementAccountId: new Uint8Array(32).fill(0xa1),
  encryptionPublicKey: new Uint8Array(65).fill(0x04),
});

describe('IDENTITY_SIGNATURE_PAYLOAD_BYTES', () => {
  it('equals 32 + 65 = 97 bytes', () => {
    expect(IDENTITY_SIGNATURE_PAYLOAD_BYTES).toBe(97);
  });
});

describe('MetadataKey', () => {
  it('round-trips Custom with arbitrary string', () => {
    const m = { tag: 'Custom' as const, value: 'app.theme' };
    expect(MetadataKey.dec(MetadataKey.enc(m))).toEqual(m);
  });

  it('round-trips each unit variant', () => {
    const variants = ['HostName', 'HostVersion', 'HostIcon', 'PlatformType', 'PlatformVersion'] as const;
    for (const tag of variants) {
      const m = { tag, value: undefined };
      expect(MetadataKey.dec(MetadataKey.enc(m))).toEqual(m);
    }
  });
});

describe('Device', () => {
  it('round-trips a 32-byte accountId and 65-byte uncompressed public key', () => {
    const d = makeDevice();
    expect(Device.dec(Device.enc(d))).toEqual(d);
  });

  it('encodes Device with the expected fixed length (32 + 65 = 97 bytes)', () => {
    expect(Device.enc(makeDevice()).length).toBe(97);
  });
});

describe('HandshakeProposalV2', () => {
  it('round-trips with empty metadata', () => {
    const p = { device: makeDevice(), metadata: [] };
    expect(HandshakeProposalV2.dec(HandshakeProposalV2.enc(p))).toEqual(p);
  });

  it('round-trips with mixed metadata variants', () => {
    const metadata: ReturnType<typeof MetadataEntry.dec>[] = [
      [{ tag: 'HostName' as const, value: undefined }, 'Polkadot Desktop'],
      [{ tag: 'HostVersion' as const, value: undefined }, '0.1.0'],
      [{ tag: 'PlatformType' as const, value: undefined }, 'macOS'],
      [{ tag: 'Custom' as const, value: 'app.theme' }, 'dark'],
    ];
    const p = { device: makeDevice(), metadata };
    expect(HandshakeProposalV2.dec(HandshakeProposalV2.enc(p))).toEqual(p);
  });
});

describe('VersionedHandshakeProposal', () => {
  it('round-trips a V2 proposal', () => {
    const versioned = {
      tag: 'V2' as const,
      value: { device: makeDevice(), metadata: [] },
    };
    expect(VersionedHandshakeProposal.dec(VersionedHandshakeProposal.enc(versioned))).toEqual(versioned);
  });

  // V2 lives at SCALE discriminant 1 (index 0 reserved for legacy V1 which
  // neither side emits). Mismatch here means the peer can't decode the
  // Desktop-emitted pairing QR.
  it('emits V2 at byte discriminant 1', () => {
    const encoded = VersionedHandshakeProposal.enc({
      tag: 'V2',
      value: { device: makeDevice(), metadata: [] },
    });
    expect(encoded[0]).toBe(1);
  });
});

describe('HandshakeSuccessV2', () => {
  it('round-trips encryptionKey, accountId, and identity signature', () => {
    const s = {
      encryptionKey: new Uint8Array(65).fill(0x04),
      accountId: new Uint8Array(32).fill(0xb2),
      identitySignature: new Uint8Array(64).fill(0xcc),
    };
    expect(HandshakeSuccessV2.dec(HandshakeSuccessV2.enc(s))).toEqual(s);
  });
});

describe('EncryptedHandshakeResponseV2', () => {
  it('round-trips Pending (single byte, no inner status — peer wire-compat)', () => {
    const r = { tag: 'Pending' as const, value: undefined };
    expect(EncryptedHandshakeResponseV2.dec(EncryptedHandshakeResponseV2.enc(r))).toEqual(r);
  });

  it('encodes Pending as a single 0x00 byte', () => {
    const encoded = EncryptedHandshakeResponseV2.enc({ tag: 'Pending', value: undefined });
    expect(encoded).toEqual(new Uint8Array([0x00]));
  });

  it('round-trips Success', () => {
    const r = {
      tag: 'Success' as const,
      value: {
        encryptionKey: new Uint8Array(65).fill(0x04),
        accountId: new Uint8Array(32).fill(0xb2),
        identitySignature: new Uint8Array(64).fill(0xcc),
      },
    };
    expect(EncryptedHandshakeResponseV2.dec(EncryptedHandshakeResponseV2.enc(r))).toEqual(r);
  });

  // Pinned wire format: Success is 161 bytes, no outer discriminant — just
  // the three fixed-length fields concatenated.
  it('encodes Success as 161 bytes (peer wire-compat)', () => {
    const encoded = EncryptedHandshakeResponseV2.enc({
      tag: 'Success',
      value: {
        encryptionKey: new Uint8Array(65).fill(0x04),
        accountId: new Uint8Array(32).fill(0xb2),
        identitySignature: new Uint8Array(64).fill(0xcc),
      },
    });
    expect(encoded.length).toBe(161);
    expect(encoded[0]).toBe(0x04);
    expect(encoded[65]).toBe(0xb2);
    expect(encoded[97]).toBe(0xcc);
  });

  it('decodes a 161-byte payload as Success even though it has no discriminant byte', () => {
    const bytes = new Uint8Array(161);
    bytes[0] = 0x04; // P-256 uncompressed marker — first byte of encryptionKey
    const decoded = EncryptedHandshakeResponseV2.dec(bytes);
    expect(decoded.tag).toBe('Success');
  });

  it('round-trips Failed with a reason string', () => {
    const r = { tag: 'Failed' as const, value: 'user declined on mobile' };
    expect(EncryptedHandshakeResponseV2.dec(EncryptedHandshakeResponseV2.enc(r))).toEqual(r);
  });
});

describe('HandshakeStatusV2', () => {
  it('round-trips AllowanceAllocation', () => {
    const s = { tag: 'AllowanceAllocation' as const, value: undefined };
    expect(HandshakeStatusV2.dec(HandshakeStatusV2.enc(s))).toEqual(s);
  });
});

describe('HandshakeResponseV2', () => {
  it('round-trips with arbitrary ciphertext and ephemeral key', () => {
    const r = {
      encrypted: new Uint8Array([1, 2, 3, 4, 5]),
      tmpKey: new Uint8Array(65).fill(0x04),
    };
    expect(HandshakeResponseV2.dec(HandshakeResponseV2.enc(r))).toEqual(r);
  });
});

describe('VersionedHandshakeResponse', () => {
  it('round-trips a V2 response', () => {
    const r = {
      tag: 'V2' as const,
      value: { encrypted: new Uint8Array([7, 8, 9]), tmpKey: new Uint8Array(65).fill(0x04) },
    };
    expect(VersionedHandshakeResponse.dec(VersionedHandshakeResponse.enc(r))).toEqual(r);
  });

  it('decodes a legacy V1 response from older mobile clients', () => {
    const r = {
      tag: 'V1' as const,
      value: { encrypted: new Uint8Array([1, 2]), tmpKey: new Uint8Array(65).fill(0x04) },
    };
    expect(VersionedHandshakeResponse.dec(VersionedHandshakeResponse.enc(r))).toEqual(r);
  });
});

describe('EncryptedHandshakeResponseV1 (legacy)', () => {
  it('round-trips encryptionKey and accountId', () => {
    const r = {
      encryptionKey: new Uint8Array(65).fill(0x04),
      accountId: new Uint8Array(32).fill(0xb2),
    };
    expect(EncryptedHandshakeResponseV1.dec(EncryptedHandshakeResponseV1.enc(r))).toEqual(r);
  });
});

describe('HandshakeResponseV1 (legacy)', () => {
  it('round-trips with arbitrary ciphertext and ephemeral key', () => {
    const r = {
      encrypted: new Uint8Array([0xff, 0xee]),
      tmpKey: new Uint8Array(65).fill(0x04),
    };
    expect(HandshakeResponseV1.dec(HandshakeResponseV1.enc(r))).toEqual(r);
  });
});
