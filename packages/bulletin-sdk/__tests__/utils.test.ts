import { describe, expect, it } from 'vitest';

import { validateChunkSize } from '../src/utils.js';

describe('Utils', () => {
  describe('validateChunkSize', () => {
    it('should validate valid chunk sizes', () => {
      expect(validateChunkSize(1024 * 1024).isOk()).toBe(true); // 1 MiB
      expect(validateChunkSize(2 * 1024 * 1024).isOk()).toBe(true); // 2 MiB (MAX_CHUNK_SIZE)
    });

    it('should reject zero size', () => {
      expect(validateChunkSize(0).isErr()).toBe(true);
    });

    it('should reject negative size', () => {
      expect(validateChunkSize(-1).isErr()).toBe(true);
    });

    it('should reject size exceeding maximum', () => {
      expect(validateChunkSize(10 * 1024 * 1024).isErr()).toBe(true);
    });
  });
});
