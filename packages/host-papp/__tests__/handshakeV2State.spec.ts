import { describe, expect, it } from 'vitest';

import { EncryptedHandshakeResponseV2 } from '../src/sso/auth/scale/handshakeV2.js';
import type { HandshakeState } from '../src/sso/auth/v2/state.js';
import {
  advance,
  canSubmitV2Statements,
  fromInnerResponse,
  idle,
  isTerminal,
  submitted,
} from '../src/sso/auth/v2/state.js';

const decode = (value: ReturnType<typeof EncryptedHandshakeResponseV2.dec>) =>
  EncryptedHandshakeResponseV2.dec(EncryptedHandshakeResponseV2.enc(value));

describe('fromInnerResponse', () => {
  it('maps Pending (single discriminant byte, no inner status) to Pending state', () => {
    const r = decode({ tag: 'Pending', value: undefined });
    expect(fromInnerResponse(r)).toEqual({ tag: 'Pending', reason: 'AllowanceAllocation' });
  });

  it('decodes a 1-byte Pending payload (peer wire-compat)', () => {
    const r = EncryptedHandshakeResponseV2.dec(new Uint8Array([0x00]));
    expect(r.tag).toBe('Pending');
    expect(fromInnerResponse(r)).toEqual({ tag: 'Pending', reason: 'AllowanceAllocation' });
  });

  it('maps Success to Success state with all four key fields', () => {
    const r = decode({
      tag: 'Success',
      value: {
        encryptionKey: new Uint8Array(65).fill(0x04),
        accountId: new Uint8Array(32).fill(0xb2),
        identitySignature: new Uint8Array(64).fill(0xcc),
        identityChatPrivateKey: new Uint8Array(32).fill(0xdd),
      },
    });
    const state = fromInnerResponse(r);
    expect(state.tag).toBe('Success');
    if (state.tag === 'Success') {
      expect(state.identityChatPublicKey.length).toBe(65);
      expect(state.userIdentityAccountId.length).toBe(32);
      expect(state.identitySignature.length).toBe(64);
      expect(state.identityChatPrivateKey.length).toBe(32);
    }
  });

  it('maps Failed to Failed state with reason string', () => {
    const r = decode({ tag: 'Failed', value: 'no slot available' });
    expect(fromInnerResponse(r)).toEqual({ tag: 'Failed', reason: 'no slot available' });
  });
});

describe('advance', () => {
  it('Idle → Submitted is allowed', () => {
    expect(advance(idle(), submitted())).toEqual(submitted());
  });

  it('Submitted → Pending is allowed', () => {
    const pending: HandshakeState = { tag: 'Pending', reason: 'AllowanceAllocation' };
    expect(advance(submitted(), pending)).toEqual(pending);
  });

  it('Pending → Success is allowed', () => {
    const pending: HandshakeState = { tag: 'Pending', reason: 'AllowanceAllocation' };
    const success: HandshakeState = {
      tag: 'Success',
      identityChatPublicKey: new Uint8Array(65),
      userIdentityAccountId: new Uint8Array(32),
      identitySignature: new Uint8Array(64),
      identityChatPrivateKey: new Uint8Array(32),
    };
    expect(advance(pending, success)).toEqual(success);
  });

  it('terminal states are absorbing — Success cannot regress to Pending', () => {
    const success: HandshakeState = {
      tag: 'Success',
      identityChatPublicKey: new Uint8Array(65),
      userIdentityAccountId: new Uint8Array(32),
      identitySignature: new Uint8Array(64),
      identityChatPrivateKey: new Uint8Array(32),
    };
    const pending: HandshakeState = { tag: 'Pending', reason: 'AllowanceAllocation' };
    expect(advance(success, pending)).toEqual(success);
  });

  it('terminal states are absorbing — Failed cannot regress to Pending', () => {
    const failed: HandshakeState = { tag: 'Failed', reason: 'declined' };
    const pending: HandshakeState = { tag: 'Pending', reason: 'AllowanceAllocation' };
    expect(advance(failed, pending)).toEqual(failed);
  });

  it('Submitted → Idle is rejected (no backwards regression)', () => {
    expect(advance(submitted(), idle())).toEqual(submitted());
  });

  it('Idle → Pending is rejected (must Submit first)', () => {
    const pending: HandshakeState = { tag: 'Pending', reason: 'AllowanceAllocation' };
    expect(advance(idle(), pending)).toEqual(idle());
  });
});

describe('isTerminal', () => {
  it('returns true for Success', () => {
    expect(
      isTerminal({
        tag: 'Success',
        identityChatPublicKey: new Uint8Array(65),
        userIdentityAccountId: new Uint8Array(32),
        identitySignature: new Uint8Array(64),
      }),
    ).toBe(true);
  });

  it('returns true for Failed', () => {
    expect(isTerminal({ tag: 'Failed', reason: 'declined' })).toBe(true);
  });

  it('returns false for Idle / Submitted / Pending', () => {
    expect(isTerminal(idle())).toBe(false);
    expect(isTerminal(submitted())).toBe(false);
    expect(isTerminal({ tag: 'Pending', reason: 'AllowanceAllocation' })).toBe(false);
  });
});

describe('canSubmitV2Statements', () => {
  it('only true in Success', () => {
    const success: HandshakeState = {
      tag: 'Success',
      identityChatPublicKey: new Uint8Array(65),
      userIdentityAccountId: new Uint8Array(32),
      identitySignature: new Uint8Array(64),
      identityChatPrivateKey: new Uint8Array(32),
    };
    expect(canSubmitV2Statements(success)).toBe(true);
    expect(canSubmitV2Statements(idle())).toBe(false);
    expect(canSubmitV2Statements(submitted())).toBe(false);
    expect(canSubmitV2Statements({ tag: 'Pending', reason: 'AllowanceAllocation' })).toBe(false);
    expect(canSubmitV2Statements({ tag: 'Failed', reason: 'x' })).toBe(false);
  });
});
