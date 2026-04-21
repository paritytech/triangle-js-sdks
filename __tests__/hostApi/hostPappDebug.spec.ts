import { describe, expect, it } from 'vitest';

import {
  emitHostPappDebugMessage,
  hasHostPappDebugListeners,
  onHostPappDebugMessage,
} from '@novasamatech/host-papp/debug';

describe('EXPERIMENTAL: host-papp debug bus', () => {
  it('has no listeners by default', () => {
    expect(hasHostPappDebugListeners()).toBe(false);
  });

  it('on/off toggles the listener count', () => {
    expect(hasHostPappDebugListeners()).toBe(false);
    const unsubscribe = onHostPappDebugMessage(() => undefined);
    expect(hasHostPappDebugListeners()).toBe(true);
    unsubscribe();
    expect(hasHostPappDebugListeners()).toBe(false);
  });

  it('delivers events to every active subscriber in insertion order', () => {
    const collectedA: string[] = [];
    const collectedB: string[] = [];
    const unsubA = onHostPappDebugMessage(e => collectedA.push(e.event));
    const unsubB = onHostPappDebugMessage(e => collectedB.push(e.event));

    emitHostPappDebugMessage({
      layer: 'sso',
      event: 'pairing_started',
      flowId: 'flow-1',
      timestamp: Date.now(),
      payload: { metadata: 'test' },
    });
    emitHostPappDebugMessage({
      layer: 'sso',
      event: 'deeplink_generated',
      flowId: 'flow-1',
      timestamp: Date.now(),
      payload: { deeplink: 'polkadotapp://pair?handshake=0x00', handshakeTopic: '0x11' },
    });

    unsubA();
    unsubB();

    expect(collectedA).toEqual(['pairing_started', 'deeplink_generated']);
    expect(collectedB).toEqual(['pairing_started', 'deeplink_generated']);
  });

  it('drops events silently when no listener is attached (no throw)', () => {
    expect(hasHostPappDebugListeners()).toBe(false);
    expect(() =>
      emitHostPappDebugMessage({
        layer: 'attestation',
        event: 'started',
        flowId: 'flow-x',
        timestamp: Date.now(),
        payload: { candidateAddress: '0xdeadbeef' },
      }),
    ).not.toThrow();
  });

  it('idempotent unsubscribe (second call is a no-op)', () => {
    const unsubscribe = onHostPappDebugMessage(() => undefined);
    expect(hasHostPappDebugListeners()).toBe(true);
    unsubscribe();
    expect(hasHostPappDebugListeners()).toBe(false);
    unsubscribe();
    expect(hasHostPappDebugListeners()).toBe(false);
  });

  it('stops delivering after unsubscribe', () => {
    const collected: string[] = [];
    const unsubscribe = onHostPappDebugMessage(e => collected.push(e.event));
    emitHostPappDebugMessage({
      layer: 'session',
      event: 'opened',
      flowId: 'sess-1',
      timestamp: Date.now(),
      payload: { sessionId: 'sess-1' },
    });
    unsubscribe();
    emitHostPappDebugMessage({
      layer: 'session',
      event: 'terminated',
      flowId: 'sess-1',
      timestamp: Date.now(),
      payload: { sessionId: 'sess-1' },
    });
    expect(collected).toEqual(['opened']);
  });
});
