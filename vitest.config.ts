/// <reference types="vitest" />

import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    dedupe: ['react'],
  },
  test: {
    exclude: ['**/node_modules/**', '**/dist/**'],
    reporters: ['dot'],
  },
});
