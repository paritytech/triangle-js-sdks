import type { Result } from 'neverthrow';
import { expect } from 'vitest';

// neverthrow-aware matchers so specs assert on Result<T, E> without
// `_unsafeUnwrap()` / `.isOk()` boilerplate. Each matcher awaits its subject,
// so it accepts a resolved `Result` or a pending `ResultAsync` interchangeably:
//   await expect(repo.read(...)).toBeOkWith(key);
//   await expect(repo.read(...)).toBeErr();

function isResult(value: unknown): value is Result<unknown, unknown> {
  return typeof value === 'object' && value !== null && 'isOk' in value && typeof value.isOk === 'function';
}

async function resolveResult(received: unknown): Promise<Result<unknown, unknown>> {
  const value = await received;
  if (!isResult(value)) {
    throw new Error(`Expected a neverthrow Result (or ResultAsync), got ${typeof value}`);
  }
  return value;
}

expect.extend({
  async toBeOk(received: unknown) {
    const result = await resolveResult(received);
    return {
      pass: result.isOk(),
      message: () => `expected Result to be Ok, but got Err(${this.utils.stringify(result._unsafeUnwrapErr())})`,
    };
  },

  async toBeOkWith(received: unknown, expected: unknown) {
    const result = await resolveResult(received);
    if (!result.isOk()) {
      return { pass: false, message: () => `expected Ok(${this.utils.stringify(expected)}), but got an Err` };
    }
    const value = result._unsafeUnwrap();
    return {
      pass: this.equals(value, expected),
      message: () => `expected Ok value to ${this.isNot ? 'not ' : ''}equal ${this.utils.diff(expected, value)}`,
    };
  },

  async toBeErr(received: unknown) {
    const result = await resolveResult(received);
    return {
      pass: result.isErr(),
      message: () => `expected Result to be Err, but got Ok(${this.utils.stringify(result._unsafeUnwrap())})`,
    };
  },

  async toBeErrWith(received: unknown, expected: unknown) {
    const result = await resolveResult(received);
    if (!result.isErr()) {
      return { pass: false, message: () => `expected Err(${this.utils.stringify(expected)}), but got an Ok` };
    }
    const error = result._unsafeUnwrapErr();
    return {
      pass: this.equals(error, expected),
      message: () => `expected Err value to ${this.isNot ? 'not ' : ''}equal ${this.utils.diff(expected, error)}`,
    };
  },
});

// Matcher type declarations live in `types/vitest-matchers/index.d.ts`, wired
// in through the root tsconfig `types` so every package program picks them up.
