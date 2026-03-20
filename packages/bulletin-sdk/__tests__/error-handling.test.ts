import { describe, expect, it } from 'vitest';

import { BulletinPreparer } from '../src/preparer.js';
import type { HashAlgorithm } from '../src/types.js';
import { BulletinError } from '../src/types.js';
import { calculateCid, cidFromBytes, parseCid } from '../src/utils.js';

describe('Error Handling', () => {
  describe('BulletinError', () => {
    it('should create error with code', () => {
      const error = new BulletinError('Test error', 'TEST_CODE');

      expect(error.message).toBe('Test error');
      expect(error.code).toBe('TEST_CODE');
      expect(error.name).toBe('BulletinError');
      expect(error.cause).toBeUndefined();
    });

    it('should create error with cause', () => {
      const cause = new Error('Original error');
      const error = new BulletinError('Wrapped error', 'WRAPPED', cause);

      expect(error.message).toBe('Wrapped error');
      expect(error.code).toBe('WRAPPED');
      expect(error.cause).toBe(cause);
    });

    it('should be instanceof Error', () => {
      const error = new BulletinError('Test', 'CODE');

      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(BulletinError);
    });

    it('should preserve stack trace', () => {
      const error = new BulletinError('Test', 'CODE');

      expect(error.stack).toBeDefined();
      expect(error.stack).toContain('BulletinError');
    });
  });

  describe('Async Error Propagation', () => {
    it('should propagate BulletinError through async chain', async () => {
      const asyncFunction = async () => {
        throw new BulletinError('Async error', 'ASYNC_ERROR');
      };

      await expect(asyncFunction()).rejects.toThrow(BulletinError);
      await expect(asyncFunction()).rejects.toMatchObject({
        code: 'ASYNC_ERROR',
        message: 'Async error',
      });
    });

    it('should preserve error type through Promise.all', async () => {
      const promises = [
        Promise.resolve(1),
        Promise.reject(new BulletinError('Error in promise', 'PROMISE_ERROR')),
        Promise.resolve(3),
      ];

      try {
        await Promise.all(promises);
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(BulletinError);
        expect((error as BulletinError).code).toBe('PROMISE_ERROR');
      }
    });

    it('should preserve error type through Promise.allSettled', async () => {
      const promises = [
        Promise.resolve(1),
        Promise.reject(new BulletinError('Error', 'SETTLED_ERROR')),
        Promise.resolve(3),
      ];

      const results = await Promise.allSettled(promises);

      expect(results[0]!.status).toBe('fulfilled');
      expect(results[1]!.status).toBe('rejected');
      expect(results[2]!.status).toBe('fulfilled');

      if (results[1]!.status === 'rejected') {
        expect(results[1]!.reason).toBeInstanceOf(BulletinError);
        expect((results[1]!.reason as BulletinError).code).toBe('SETTLED_ERROR');
      }
    });
  });

  describe('Client Error Handling', () => {
    it('should return err for empty data in prepareStore', () => {
      const preparer = new BulletinPreparer();
      const result = preparer.prepareStore(new Uint8Array(0));

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr()).toBeInstanceOf(BulletinError);
      expect(result._unsafeUnwrapErr().code).toBe('EMPTY_DATA');
    });

    it('should return DATA_TOO_LARGE for data exceeding chunkingThreshold in prepareStore', () => {
      const preparer = new BulletinPreparer({ chunkingThreshold: 1024 });
      const oversized = new Uint8Array(1025);
      const result = preparer.prepareStore(oversized);

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().code).toBe('DATA_TOO_LARGE');
    });

    it('should return err for empty data in prepareStoreChunked', () => {
      const preparer = new BulletinPreparer();
      const result = preparer.prepareStoreChunked(new Uint8Array(0));

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().code).toBe('EMPTY_DATA');
    });
  });

  describe('CID Error Handling', () => {
    it('should return err for invalid CID string', () => {
      const result = parseCid('not-a-valid-cid');
      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().message).toContain('Failed to parse CID');
    });

    it('should return err for empty CID string', () => {
      expect(parseCid('').isErr()).toBe(true);
    });

    it('should return err for invalid CID bytes', () => {
      const invalidBytes = new Uint8Array([0xff, 0xff, 0xff]);
      expect(cidFromBytes(invalidBytes).isErr()).toBe(true);
    });

    it('should return err for empty CID bytes', () => {
      expect(cidFromBytes(new Uint8Array(0)).isErr()).toBe(true);
    });

    it('should return err for unsupported hash algorithm', () => {
      const data = new Uint8Array([1, 2, 3, 4, 5]);
      const result = calculateCid(data, 0x55, 0xff as HashAlgorithm);
      expect(result.isErr()).toBe(true);
    });
  });

  describe('Error Message Quality', () => {
    it('should include useful context in error messages', () => {
      const preparer = new BulletinPreparer();
      const result = preparer.prepareStore(new Uint8Array(0));

      expect(result.isErr()).toBe(true);
      const bulletinError = result._unsafeUnwrapErr();

      // Error should have meaningful message
      expect(bulletinError.message.length).toBeGreaterThan(10);

      // Error should have a code
      expect(bulletinError.code).toBeDefined();
      expect(bulletinError.code.length).toBeGreaterThan(0);
    });

    it('should include cause when wrapping errors', () => {
      const originalError = new TypeError('Cannot read property of undefined');
      const wrappedError = new BulletinError('Operation failed', 'OP_FAILED', originalError);

      expect(wrappedError.cause).toBe(originalError);
      expect((wrappedError.cause as Error).message).toContain('undefined');
    });
  });
});
