import { describe, expect, it, vi } from 'vitest';

vi.mock('verifiablejs/bundler', () => ({
  member_from_entropy: vi.fn(() => new Uint8Array(32)),
  sign: vi.fn(() => new Uint8Array(64)),
}));

vi.mock('polkadot-api/signer', () => ({
  getPolkadotSigner: vi.fn(() => ({
    publicKey: new Uint8Array(32),
    signBytes: vi.fn(),
    signTx: vi.fn(),
  })),
}));

vi.mock('../src/crypto.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../src/crypto.js')>();
  return {
    ...actual,
    getEncrPub: vi.fn(() => new Uint8Array(65)),
  };
});

import { onHostPappDebugMessage } from '../src/debugBus.js';
import type { AttestationDebugEvent } from '../src/debugTypes.js';
import { createAttestationService, withRetry } from '../src/sso/auth/attestationService.js';

describe('withRetry', () => {
  it('resolves immediately when fn succeeds on first call', async () => {
    const fn = vi.fn().mockResolvedValue('ok');

    const result = await withRetry(fn);

    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries once and resolves when fn fails then succeeds', async () => {
    const fn = vi.fn().mockRejectedValueOnce(new Error('Stale')).mockResolvedValueOnce('ok');

    const result = await withRetry(fn);

    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('rejects after exhausting all retries', async () => {
    const error = new Error('Stale');
    const fn = vi.fn().mockRejectedValue(error);

    await expect(withRetry(fn)).rejects.toThrow('Stale');
    expect(fn).toHaveBeenCalledTimes(2); // 1 initial + 1 retry
  });

  it('respects custom maxRetries', async () => {
    const error = new Error('Stale');
    const fn = vi.fn().mockRejectedValue(error);

    await expect(withRetry(fn, 3)).rejects.toThrow('Stale');
    expect(fn).toHaveBeenCalledTimes(4); // 1 initial + 3 retries
  });

  it('retries up to maxRetries and resolves on last attempt', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('fail 1'))
      .mockRejectedValueOnce(new Error('fail 2'))
      .mockResolvedValueOnce('recovered');

    const result = await withRetry(fn, 2);

    expect(result).toBe('recovered');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('does not retry when maxRetries is 0', async () => {
    const error = new Error('Stale');
    const fn = vi.fn().mockRejectedValue(error);

    await expect(withRetry(fn, 0)).rejects.toThrow('Stale');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('preserves the last error when all retries fail', async () => {
    const fn = vi.fn().mockRejectedValueOnce(new Error('first')).mockRejectedValueOnce(new Error('second'));

    await expect(withRetry(fn, 1)).rejects.toThrow('second');
  });

  it('propagates non-Error rejections', async () => {
    const fn = vi.fn().mockRejectedValue('string error');

    await expect(withRetry(fn, 0)).rejects.toBe('string error');
  });
});

describe('createAttestationService', () => {
  function createMockAccount() {
    return {
      secret: new Uint8Array(64) as any,
      publicKey: new Uint8Array(32) as any,
      entropy: new Uint8Array(32),
      sign: vi.fn(() => new Uint8Array(64)),
      verify: vi.fn(() => true),
    };
  }

  describe('grantVerifierAllowance', () => {
    function makeService(opts: { allowance: number; signAndSubmit: ReturnType<typeof vi.fn> }) {
      const mockApi = {
        query: {
          PeopleLite: {
            AttestationAllowance: { getValue: vi.fn().mockResolvedValue(opts.allowance) },
          },
        },
        tx: {
          PeopleLite: {
            increase_attestation_allowance: vi.fn(() => ({ decodedCall: {} })),
          },
          Sudo: {
            sudo: vi.fn(() => ({ signAndSubmit: opts.signAndSubmit })),
          },
        },
      };
      const lazyClient = { getClient: () => ({ getUnsafeApi: () => mockApi }) } as any;
      return createAttestationService(lazyClient);
    }

    it('retries signAndSubmit on failure and resolves on the second attempt', async () => {
      const signAndSubmit = vi.fn().mockRejectedValueOnce(new Error('Stale')).mockResolvedValueOnce(undefined);
      const service = makeService({ allowance: 0, signAndSubmit });

      const result = await service.grantVerifierAllowance(createMockAccount());

      expect(result.isOk()).toBe(true);
      expect(signAndSubmit).toHaveBeenCalledTimes(2);
    });

    it('fails after retries are exhausted', async () => {
      const signAndSubmit = vi.fn().mockRejectedValue(new Error('Stale'));
      const service = makeService({ allowance: 0, signAndSubmit });

      const result = await service.grantVerifierAllowance(createMockAccount());

      expect(result.isErr()).toBe(true);
      expect(signAndSubmit).toHaveBeenCalledTimes(2);
    });

    it('skips the transaction when allowance is already sufficient', async () => {
      const signAndSubmit = vi.fn();
      const service = makeService({ allowance: 5, signAndSubmit });

      const result = await service.grantVerifierAllowance(createMockAccount());

      expect(result.isOk()).toBe(true);
      expect(signAndSubmit).not.toHaveBeenCalled();
    });
  });

  describe('debug emits', () => {
    const FLOW_ID = 'flow-attestation-test';

    function captureAttestationEvents() {
      const events: AttestationDebugEvent[] = [];
      const unsubscribe = onHostPappDebugMessage(event => {
        if (event.layer === 'attestation') events.push(event);
      });
      return { events, unsubscribe };
    }

    function makeRegisterableService() {
      const subscribeSpy = vi.fn(
        (handlers: { next: (event: { type: string; found?: boolean; ok?: boolean }) => void }) => {
          // defer next() so the `subscription` binding inside the production code
          // is in scope by the time `subscription.unsubscribe()` is called
          queueMicrotask(() => handlers.next({ type: 'finalized', ok: true }));
          return { unsubscribe: vi.fn() };
        },
      );
      const mockApi = {
        query: {
          PeopleLite: {
            AttestationAllowance: { getValue: vi.fn().mockResolvedValue(10) },
          },
        },
        tx: {
          PeopleLite: {
            increase_attestation_allowance: vi.fn(() => ({ decodedCall: {} })),
            attest: vi.fn(() => ({ signSubmitAndWatch: () => ({ subscribe: subscribeSpy }) })),
          },
          Sudo: {
            sudo: vi.fn(() => ({ signAndSubmit: vi.fn() })),
          },
        },
      };
      const lazyClient = { getClient: () => ({ getUnsafeApi: () => mockApi }) } as any;
      return createAttestationService(lazyClient, FLOW_ID);
    }

    it('claimUsername emits username_claimed', () => {
      const { events, unsubscribe } = captureAttestationEvents();
      try {
        const service = makeRegisterableService();
        const username = service.claimUsername();
        expect(events).toContainEqual(
          expect.objectContaining({
            event: 'username_claimed',
            flowId: FLOW_ID,
            payload: { username },
          }),
        );
      } finally {
        unsubscribe();
      }
    });

    it('grantVerifierAllowance emits allowance_granted on success', async () => {
      const { events, unsubscribe } = captureAttestationEvents();
      try {
        const service = makeRegisterableService();
        const result = await service.grantVerifierAllowance(createMockAccount());
        expect(result.isOk()).toBe(true);
        expect(events.some(e => e.event === 'allowance_granted' && e.flowId === FLOW_ID)).toBe(true);
      } finally {
        unsubscribe();
      }
    });

    it('deriveAttestationParams emits vrf_proof_generated', async () => {
      const { events, unsubscribe } = captureAttestationEvents();
      try {
        const service = makeRegisterableService();
        const result = await service.deriveAttestationParams('guest.0001', createMockAccount(), createMockAccount());
        expect(result.isOk()).toBe(true);
        expect(events.some(e => e.event === 'vrf_proof_generated' && e.flowId === FLOW_ID)).toBe(true);
      } finally {
        unsubscribe();
      }
    });

    it('registerLitePerson emits person_registered after successful submission', async () => {
      const { events, unsubscribe } = captureAttestationEvents();
      try {
        const service = makeRegisterableService();
        const result = await service.registerLitePerson('guest.0001', createMockAccount(), createMockAccount());
        expect(result.isOk()).toBe(true);
        const personRegistered = events.find(e => e.event === 'person_registered');
        expect(personRegistered).toBeDefined();
        expect(personRegistered?.flowId).toBe(FLOW_ID);
        expect(personRegistered?.payload).toMatchObject({ username: 'guest.0001' });
      } finally {
        unsubscribe();
      }
    });

    it('omits emits entirely when no debugFlowId is provided', () => {
      const { events, unsubscribe } = captureAttestationEvents();
      try {
        // service constructed without flowId — must not emit anything
        const mockApi = {
          query: { PeopleLite: { AttestationAllowance: { getValue: vi.fn().mockResolvedValue(10) } } },
          tx: { PeopleLite: { increase_attestation_allowance: vi.fn() }, Sudo: { sudo: vi.fn() } },
        };
        const lazyClient = { getClient: () => ({ getUnsafeApi: () => mockApi }) } as any;
        const service = createAttestationService(lazyClient);
        service.claimUsername();
        expect(events).toHaveLength(0);
      } finally {
        unsubscribe();
      }
    });
  });
});
