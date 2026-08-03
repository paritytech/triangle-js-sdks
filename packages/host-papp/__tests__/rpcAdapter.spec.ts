import { describe, expect, it } from 'vitest';

import { decodeRawIdentity } from '../src/identity/rpcAdapter.js';

const textDecoder = new TextDecoder();
const encode = (value: string) => new TextEncoder().encode(value);

const KEY = 'ab'.repeat(32);
const PADDING = '00'.repeat(32);

// The descriptor's shape is wider than what `decodeRawIdentity` reads, so cast at the boundary.
const asRaw = (value: unknown) => value as Parameters<typeof decodeRawIdentity>[1];

function rawConsumers(identifierKey: string) {
  return asRaw({
    identifier_key: identifierKey,
    full_username: encode('alice'),
    lite_username: encode('alice.01'),
    credibility: { type: 'Lite' as const, value: undefined },
  });
}

describe('decodeRawIdentity', () => {
  it('unwraps an X25519 identifier key from the RFC-0004 container', () => {
    const identity = decodeRawIdentity('acc-1', rawConsumers(`0x00${KEY}${PADDING}`), textDecoder);

    expect(identity).toMatchObject({ accountId: 'acc-1', liteUsername: 'alice.01', identifierKey: `0x${KEY}` });
  });

  it('returns a null key for an unimplemented keypair type', () => {
    // 0x04 + 64 bytes — the pre-RFC-0004 uncompressed P-256 point.
    const identity = decodeRawIdentity('acc-1', rawConsumers(`0x04${'cd'.repeat(64)}`), textDecoder);

    expect(identity?.identifierKey).toBeNull();
    expect(identity?.liteUsername).toBe('alice.01');
  });

  it('returns a null key for a truncated container', () => {
    expect(decodeRawIdentity('acc-1', rawConsumers('0x00abcd'), textDecoder)?.identifierKey).toBeNull();
  });

  it('returns null for a missing consumer record', () => {
    expect(decodeRawIdentity('acc-1', undefined, textDecoder)).toBeNull();
  });

  it('decodes a Person record', () => {
    const raw = asRaw({
      identifier_key: `0x00${KEY}${PADDING}`,
      full_username: encode('alice'),
      lite_username: encode('alice.01'),
      credibility: { type: 'Person' as const, value: { alias: '0xdead', last_update: 42n } },
    });

    expect(decodeRawIdentity('acc-1', raw, textDecoder)).toEqual({
      accountId: 'acc-1',
      fullUsername: 'alice',
      liteUsername: 'alice.01',
      credibility: { type: 'Person', alias: '0xdead', lastUpdate: '42' },
      identifierKey: `0x${KEY}`,
    });
  });

  it('reports a missing last_update as a null lastUpdate', () => {
    const raw = asRaw({ credibility: { type: 'Person' as const, value: { alias: '0xdead' } } });

    expect(decodeRawIdentity('acc-1', raw, textDecoder)).toEqual({
      accountId: 'acc-1',
      fullUsername: null,
      liteUsername: '',
      credibility: { type: 'Person', alias: '0xdead', lastUpdate: null },
      identifierKey: null,
    });
  });
});
