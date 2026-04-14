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
    it('retries signAndSubmit on failure', async () => {
      const signAndSubmit = vi.fn().mockRejectedValueOnce(new Error('Stale')).mockResolvedValueOnce(undefined);
      const mockApi = {
        query: {
          PeopleLite: {
            AttestationAllowance: {
              getValue: vi.fn().mockResolvedValue(0),
            },
          },
        },
        tx: {
          PeopleLite: {
            increase_attestation_allowance: vi.fn(() => ({ decodedCall: {} })),
          },
          Sudo: {
            sudo: vi.fn(() => ({ signAndSubmit })),
          },
        },
      };

      const lazyClient = {
        getClient: () => ({ getUnsafeApi: () => mockApi }),
      } as any;

      const service = createAttestationService(lazyClient);
      const result = await service.grantVerifierAllowance(createMockAccount());

      expect(result.isOk()).toBe(true);
      expect(signAndSubmit).toHaveBeenCalledTimes(2);
    });

    it('fails after retry is also exhausted', async () => {
      const signAndSubmit = vi.fn().mockRejectedValue(new Error('Stale'));
      const mockApi = {
        query: {
          PeopleLite: {
            AttestationAllowance: {
              getValue: vi.fn().mockResolvedValue(0),
            },
          },
        },
        tx: {
          PeopleLite: {
            increase_attestation_allowance: vi.fn(() => ({ decodedCall: {} })),
          },
          Sudo: {
            sudo: vi.fn(() => ({ signAndSubmit })),
          },
        },
      };

      const lazyClient = {
        getClient: () => ({ getUnsafeApi: () => mockApi }),
      } as any;

      const service = createAttestationService(lazyClient);
      const result = await service.grantVerifierAllowance(createMockAccount());

      expect(result.isErr()).toBe(true);
      expect(signAndSubmit).toHaveBeenCalledTimes(2);
    });

    it('skips transaction when allowance is already sufficient', async () => {
      const signAndSubmit = vi.fn();
      const mockApi = {
        query: {
          PeopleLite: {
            AttestationAllowance: {
              getValue: vi.fn().mockResolvedValue(5),
            },
          },
        },
        tx: {
          PeopleLite: {
            increase_attestation_allowance: vi.fn(() => ({ decodedCall: {} })),
          },
          Sudo: {
            sudo: vi.fn(() => ({ signAndSubmit })),
          },
        },
      };

      const lazyClient = {
        getClient: () => ({ getUnsafeApi: () => mockApi }),
      } as any;

      const service = createAttestationService(lazyClient);
      const result = await service.grantVerifierAllowance(createMockAccount());

      expect(result.isOk()).toBe(true);
      expect(signAndSubmit).not.toHaveBeenCalled();
    });
  });
});
