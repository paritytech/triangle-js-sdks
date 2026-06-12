import { p256 } from '@noble/curves/nist.js';
import type { CodecType } from 'scale-ts';
import { describe, expect, it } from 'vitest';

import type { EncryptedHandshakeResponseV2 } from '../src/sso/auth/scale/handshakeV2.js';
import type { HandshakeState } from '../src/sso/auth/v2/state.js';
import {
  advance,
  canSubmitV2Statements,
  fromInnerResponse,
  idle,
  isTerminal,
  submitted,
} from '../src/sso/auth/v2/state.js';

const fixedChatPrivateKey = new Uint8Array(32).fill(0xdd);
const fixedChatPublicKey = p256.getPublicKey(fixedChatPrivateKey, false);
const fixedSsoEncPubKey = new Uint8Array(65).fill(0x06);
const fixedRootEntropySource = new Uint8Array(32).fill(0x07);

const makeSuccess = (overrides: Partial<HandshakeState & { tag: 'Success' }> = {}): HandshakeState => ({
  tag: 'Success',
  identityAccountId: new Uint8Array(32).fill(0xa1),
  rootAccountId: new Uint8Array(32).fill(0xa2),
  identityChatPrivateKey: fixedChatPrivateKey,
  identityChatPublicKey: fixedChatPublicKey,
  deviceEncPubKey: new Uint8Array(65).fill(0x04),
  ssoEncPubKey: fixedSsoEncPubKey,
  rootEntropySource: fixedRootEntropySource,
  peerStatementAccountId: null,
  ...overrides,
});

describe('fromInnerResponse', () => {
  it('maps Pending to Pending state', () => {
    const r: CodecType<typeof EncryptedHandshakeResponseV2> = {
      tag: 'Pending',
      value: { tag: 'AllowanceAllocation', value: undefined },
    };
    expect(fromInnerResponse(r)).toEqual({ tag: 'Pending', reason: 'AllowanceAllocation' });
  });

  it('maps Success with rootEntropySource to Success state and derives identityChatPublicKey from priv key', () => {
    const r: CodecType<typeof EncryptedHandshakeResponseV2> = {
      tag: 'Success',
      value: {
        identityAccountId: new Uint8Array(32).fill(0xa1),
        rootAccountId: new Uint8Array(32).fill(0xa2),
        identityChatPrivateKey: fixedChatPrivateKey,
        ssoEncPubKey: fixedSsoEncPubKey,
        deviceEncPubKey: new Uint8Array(65).fill(0x04),
        rootEntropySource: fixedRootEntropySource,
      },
    };
    const state = fromInnerResponse(r);
    expect(state.tag).toBe('Success');
    if (state.tag !== 'Success') return;
    expect(state.identityAccountId).toEqual(new Uint8Array(32).fill(0xa1));
    expect(state.rootAccountId).toEqual(new Uint8Array(32).fill(0xa2));
    expect(state.identityChatPrivateKey).toEqual(fixedChatPrivateKey);
    expect(state.identityChatPublicKey).toEqual(fixedChatPublicKey);
    expect(state.deviceEncPubKey).toEqual(new Uint8Array(65).fill(0x04));
    expect(state.ssoEncPubKey).toEqual(fixedSsoEncPubKey);
    expect(state.rootEntropySource).toEqual(fixedRootEntropySource);
  });

  it('maps Failed to Failed state with reason string', () => {
    const r: CodecType<typeof EncryptedHandshakeResponseV2> = { tag: 'Failed', value: 'no slot available' };
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
    const success = makeSuccess();
    expect(advance(pending, success)).toEqual(success);
  });

  it('terminal states are absorbing — Success cannot regress to Pending', () => {
    const success = makeSuccess();
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
    expect(isTerminal(makeSuccess())).toBe(true);
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
    expect(canSubmitV2Statements(makeSuccess())).toBe(true);
    expect(canSubmitV2Statements(idle())).toBe(false);
    expect(canSubmitV2Statements(submitted())).toBe(false);
    expect(canSubmitV2Statements({ tag: 'Pending', reason: 'AllowanceAllocation' })).toBe(false);
    expect(canSubmitV2Statements({ tag: 'Failed', reason: 'x' })).toBe(false);
  });
});
