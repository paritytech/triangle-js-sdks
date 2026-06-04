import { p256 } from '@noble/curves/nist.js';
import { str } from 'scale-ts';
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
  HandshakeSuccessV2Legacy,
  HandshakeSuccessV2_v021,
  MetadataKey,
  VersionedHandshakeProposal,
  VersionedHandshakeResponse,
  decodeEncryptedHandshakeResponseV2,
  deriveIdentityChatPublicKey,
} from '../src/sso/auth/scale/handshakeV2.js';

const fixedChatPrivateKey = new Uint8Array(32).fill(0xdd);
const fixedChatPublicKey = p256.getPublicKey(fixedChatPrivateKey, false);
const fixedSsoEncPubKey = new Uint8Array(65).fill(0x06);

const makeDevice = () => ({
  statementAccountId: new Uint8Array(32).fill(0xa1),
  encryptionPublicKey: new Uint8Array(65).fill(0x04),
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

describe('HandshakeSuccessV2 (spec v0.2.2, 226 bytes)', () => {
  it('round-trips identityAccountId, rootAccountId, identityChatPrivateKey, ssoEncPubKey, deviceEncPubKey', () => {
    const input = {
      identityAccountId: new Uint8Array(32).fill(0xa1),
      rootAccountId: new Uint8Array(32).fill(0xa2),
      identityChatPrivateKey: fixedChatPrivateKey,
      ssoEncPubKey: fixedSsoEncPubKey,
      deviceEncPubKey: new Uint8Array(65).fill(0x04),
    };
    const decoded = HandshakeSuccessV2.dec(HandshakeSuccessV2.enc(input));
    expect(decoded).toEqual(input);
  });

  it('encodes to exactly 226 bytes', () => {
    const encoded = HandshakeSuccessV2.enc({
      identityAccountId: new Uint8Array(32).fill(0xa1),
      rootAccountId: new Uint8Array(32).fill(0xa2),
      identityChatPrivateKey: fixedChatPrivateKey,
      ssoEncPubKey: fixedSsoEncPubKey,
      deviceEncPubKey: new Uint8Array(65).fill(0x04),
    });
    expect(encoded.length).toBe(226);
  });
});

describe('HandshakeSuccessV2_v021 (spec v0.2.1, 161 bytes)', () => {
  it('round-trips identityAccountId, rootAccountId, identityChatPrivateKey, deviceEncPubKey', () => {
    const input = {
      identityAccountId: new Uint8Array(32).fill(0xa1),
      rootAccountId: new Uint8Array(32).fill(0xa2),
      identityChatPrivateKey: fixedChatPrivateKey,
      deviceEncPubKey: new Uint8Array(65).fill(0x04),
    };
    const decoded = HandshakeSuccessV2_v021.dec(HandshakeSuccessV2_v021.enc(input));
    expect(decoded).toEqual(input);
  });

  it('encodes to exactly 161 bytes', () => {
    const encoded = HandshakeSuccessV2_v021.enc({
      identityAccountId: new Uint8Array(32).fill(0xa1),
      rootAccountId: new Uint8Array(32).fill(0xa2),
      identityChatPrivateKey: fixedChatPrivateKey,
      deviceEncPubKey: new Uint8Array(65).fill(0x04),
    });
    expect(encoded.length).toBe(161);
  });
});

describe('HandshakeSuccessV2Legacy (spec v0.2, 129 bytes)', () => {
  it('round-trips identityAccountId, identityChatPrivateKey, deviceEncPubKey', () => {
    const input = {
      identityAccountId: new Uint8Array(32).fill(0xa1),
      identityChatPrivateKey: fixedChatPrivateKey,
      deviceEncPubKey: new Uint8Array(65).fill(0x04),
    };
    const decoded = HandshakeSuccessV2Legacy.dec(HandshakeSuccessV2Legacy.enc(input));
    expect(decoded).toEqual(input);
  });

  it('encodes to exactly 129 bytes', () => {
    const encoded = HandshakeSuccessV2Legacy.enc({
      identityAccountId: new Uint8Array(32).fill(0xa1),
      identityChatPrivateKey: fixedChatPrivateKey,
      deviceEncPubKey: new Uint8Array(65).fill(0x04),
    });
    expect(encoded.length).toBe(129);
  });
});

describe('decodeEncryptedHandshakeResponseV2 (length-dispatched plaintext decoder)', () => {
  it('decodes Pending(AllowanceAllocation) = 0x00 0x00', () => {
    const decoded = decodeEncryptedHandshakeResponseV2(new Uint8Array([0x00, 0x00]));
    expect(decoded).toEqual({ tag: 'Pending', value: { tag: 'AllowanceAllocation', value: undefined } });
  });

  it('decodes a 226-byte v0.2.2 Success body with ssoEncPubKey', () => {
    const body = HandshakeSuccessV2.enc({
      identityAccountId: new Uint8Array(32).fill(0xa1),
      rootAccountId: new Uint8Array(32).fill(0xa2),
      identityChatPrivateKey: fixedChatPrivateKey,
      ssoEncPubKey: fixedSsoEncPubKey,
      deviceEncPubKey: new Uint8Array(65).fill(0x04),
    });
    const bytes = new Uint8Array(1 + body.length);
    bytes[0] = 0x01;
    bytes.set(body, 1);
    const decoded = decodeEncryptedHandshakeResponseV2(bytes);
    expect(decoded.tag).toBe('Success');
    if (decoded.tag !== 'Success') return;
    expect(decoded.value.rootAccountId).toEqual(new Uint8Array(32).fill(0xa2));
    expect(decoded.value.ssoEncPubKey).toEqual(fixedSsoEncPubKey);
    expect(decoded.value.deviceEncPubKey).toEqual(new Uint8Array(65).fill(0x04));
  });

  it('decodes a 161-byte v0.2.1 Success body with rootAccountId and surfaces ssoEncPubKey as null', () => {
    const body = HandshakeSuccessV2_v021.enc({
      identityAccountId: new Uint8Array(32).fill(0xa1),
      rootAccountId: new Uint8Array(32).fill(0xa2),
      identityChatPrivateKey: fixedChatPrivateKey,
      deviceEncPubKey: new Uint8Array(65).fill(0x04),
    });
    const bytes = new Uint8Array(1 + body.length);
    bytes[0] = 0x01;
    bytes.set(body, 1);
    const decoded = decodeEncryptedHandshakeResponseV2(bytes);
    expect(decoded.tag).toBe('Success');
    if (decoded.tag !== 'Success') return;
    expect(decoded.value.rootAccountId).toEqual(new Uint8Array(32).fill(0xa2));
    expect(decoded.value.identityChatPrivateKey).toEqual(fixedChatPrivateKey);
    expect(decoded.value.ssoEncPubKey).toBeNull();
  });

  it('decodes a 129-byte v0.2 Success body and surfaces rootAccountId as null', () => {
    const body = HandshakeSuccessV2Legacy.enc({
      identityAccountId: new Uint8Array(32).fill(0xa1),
      identityChatPrivateKey: fixedChatPrivateKey,
      deviceEncPubKey: new Uint8Array(65).fill(0x04),
    });
    const bytes = new Uint8Array(1 + body.length);
    bytes[0] = 0x01;
    bytes.set(body, 1);
    const decoded = decodeEncryptedHandshakeResponseV2(bytes);
    expect(decoded.tag).toBe('Success');
    if (decoded.tag !== 'Success') return;
    expect(decoded.value.rootAccountId).toBeNull();
    expect(decoded.value.ssoEncPubKey).toBeNull();
    expect(decoded.value.identityAccountId).toEqual(new Uint8Array(32).fill(0xa1));
  });

  it('rejects a Success body of unknown length', () => {
    const bytes = new Uint8Array(50);
    bytes[0] = 0x01;
    expect(() => decodeEncryptedHandshakeResponseV2(bytes)).toThrow(/not in \{129, 161, 226\}/);
  });

  it('decodes Failed with a UTF-8 reason string', () => {
    const reason = 'duplicate';
    const reasonBytes = str.enc(reason);
    const bytes = new Uint8Array(1 + reasonBytes.length);
    bytes[0] = 0x02;
    bytes.set(reasonBytes, 1);
    expect(decodeEncryptedHandshakeResponseV2(bytes)).toEqual({ tag: 'Failed', value: reason });
  });

  it('rejects an empty plaintext', () => {
    expect(() => decodeEncryptedHandshakeResponseV2(new Uint8Array(0))).toThrow(/empty plaintext/);
  });

  it('rejects an unknown variant discriminant', () => {
    expect(() => decodeEncryptedHandshakeResponseV2(new Uint8Array([0x07, 0x00]))).toThrow(/unknown variant/);
  });
});

describe('EncryptedHandshakeResponseV2 (native scale-ts Enum, used for encode)', () => {
  it('encodes Pending(AllowanceAllocation) as 0x00 0x00', () => {
    const encoded = EncryptedHandshakeResponseV2.enc({
      tag: 'Pending',
      value: { tag: 'AllowanceAllocation', value: undefined },
    });
    expect(encoded).toEqual(new Uint8Array([0x00, 0x00]));
  });

  it('round-trips Success on the v0.2.2 wire format', () => {
    const success = {
      tag: 'Success' as const,
      value: {
        identityAccountId: new Uint8Array(32).fill(0xa1),
        rootAccountId: new Uint8Array(32).fill(0xa2),
        identityChatPrivateKey: fixedChatPrivateKey,
        ssoEncPubKey: fixedSsoEncPubKey,
        deviceEncPubKey: new Uint8Array(65).fill(0x04),
      },
    };
    const encoded = EncryptedHandshakeResponseV2.enc(success);
    expect(encoded.length).toBe(1 + 226);
    expect(encoded[0]).toBe(0x01);
    expect(EncryptedHandshakeResponseV2.dec(encoded)).toEqual(success);
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

describe('deriveIdentityChatPublicKey', () => {
  it('returns the uncompressed 65-byte P-256 public key matching @noble', () => {
    expect(deriveIdentityChatPublicKey(fixedChatPrivateKey)).toEqual(fixedChatPublicKey);
  });
});
