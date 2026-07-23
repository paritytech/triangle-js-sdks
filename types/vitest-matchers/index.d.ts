// Ambient type augmentation for the neverthrow Vitest matchers registered at
// runtime in `vitest.setup.ts`. Resolved via the root tsconfig `types` /
// `typeRoots`, so every package program sees the matchers without importing
// anything. Each matcher awaits its subject, so `expect(...)` must be awaited.
import 'vitest';

interface NeverthrowMatchers<R = unknown> {
  /** Asserts the awaited subject is an `Ok`. */
  toBeOk(): R;
  /** Asserts the awaited subject is an `Ok` whose value deep-equals `expected`. */
  toBeOkWith(expected: unknown): R;
  /** Asserts the awaited subject is an `Err`. */
  toBeErr(): R;
  /** Asserts the awaited subject is an `Err` whose error deep-equals `expected`. */
  toBeErrWith(expected: unknown): R;
}

declare module 'vitest' {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  interface Assertion<T = any> extends NeverthrowMatchers<Promise<void>> {}
  interface AsymmetricMatchersContaining extends NeverthrowMatchers {}
}
