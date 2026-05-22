import { fromHex } from 'polkadot-api/utils';
import { describe, expect, it } from 'vitest';

import { VersionedHandshakeProposal } from '../src/sso/auth/scale/handshakeV2.js';
import type { HandshakeMetadata } from '../src/sso/auth/v2/proposal.js';
import { buildPairingDeeplink, encodeProposal } from '../src/sso/auth/v2/proposal.js';

const device = {
  statementAccountPublicKey: new Uint8Array(32).fill(0xa1),
  encryptionPublicKey: new Uint8Array(65).fill(0x04),
};

const metadata: HandshakeMetadata = {
  hostName: 'Polkadot Desktop',
  hostVersion: '1.2.3',
  platformType: 'macOS',
  platformVersion: '15.0',
};

describe('encodeProposal', () => {
  it('round-trips through VersionedHandshakeProposal', () => {
    const encoded = encodeProposal(device, metadata);
    const decoded = VersionedHandshakeProposal.dec(encoded);

    expect(decoded.tag).toBe('V2');
    if (decoded.tag !== 'V2') return;
    expect(decoded.value.device.statementAccountId).toEqual(device.statementAccountPublicKey);
    expect(decoded.value.device.encryptionPublicKey).toEqual(device.encryptionPublicKey);
  });

  it('emits V2 at byte discriminant 1 (peer wire-compat)', () => {
    const encoded = encodeProposal(device, metadata);
    expect(encoded[0]).toBe(1);
  });

  it('encodes hostName under MetadataKey.HostName', () => {
    const encoded = encodeProposal(device, metadata);
    const decoded = VersionedHandshakeProposal.dec(encoded);
    if (decoded.tag !== 'V2') throw new Error('expected V2');

    const entries = decoded.value.metadata.map(([key, value]) => ({ tag: key.tag, value }));
    expect(entries).toContainEqual({ tag: 'HostName', value: 'Polkadot Desktop' });
    expect(entries).toContainEqual({ tag: 'HostVersion', value: '1.2.3' });
    expect(entries).toContainEqual({ tag: 'PlatformType', value: 'macOS' });
    expect(entries).toContainEqual({ tag: 'PlatformVersion', value: '15.0' });
  });

  it('omits absent metadata fields', () => {
    const encoded = encodeProposal(device, { hostName: 'just a host' });
    const decoded = VersionedHandshakeProposal.dec(encoded);
    if (decoded.tag !== 'V2') throw new Error('expected V2');

    expect(decoded.value.metadata).toHaveLength(1);
    expect(decoded.value.metadata[0]?.[0]?.tag).toBe('HostName');
  });
});

describe('buildPairingDeeplink', () => {
  it('builds a polkadotapp://pair?handshake=<hex> URL', () => {
    const url = buildPairingDeeplink(device, metadata);
    expect(url).toMatch(/^polkadotapp:\/\/pair\?handshake=[0-9a-f]+$/);
  });

  it('embeds the encoded proposal hex in the handshake query param', () => {
    const url = buildPairingDeeplink(device, metadata);
    const match = url.match(/^polkadotapp:\/\/pair\?handshake=(.+)$/);
    expect(match).not.toBeNull();
    if (!match) return;

    const expectedBytes = encodeProposal(device, metadata);
    expect(fromHex(`0x${match[1] ?? ''}`)).toEqual(expectedBytes);
  });
});
