export function toError(err: unknown) {
  if (err instanceof Error) {
    return err;
  }

  if (err) {
    return new Error(err.toString());
  }

  return new Error('Unknown error occurred.');
}

/**
 * Type guard that checks is value nullable
 *
 * @param value Value to be checked
 *
 * @returns {Boolean}
 */
export function nullable(value: unknown): value is null | undefined {
  return value === null || value === undefined;
}
