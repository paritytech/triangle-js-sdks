import type { ResultAsync } from 'neverthrow';
import { err, ok } from 'neverthrow';

export function unwrapVersionedResult<OK, KO, V extends string>(
  version: V,
  result: ResultAsync<{ tag: V; value: OK }, { tag: V; value: KO }>,
) {
  return result
    .orElse(payload => {
      if (payload.tag !== version) {
        return err(new Error(`Unsupported result version ${payload.tag}`));
      }
      return err(payload.value);
    })
    .andThen(payload => {
      if (payload.tag !== version) {
        return err(new Error(`Unsupported result version ${payload.tag}`));
      }

      return ok(payload.value);
    });
}

export function resultToPromise<T>(result: ResultAsync<T, unknown>) {
  return new Promise<T>((resolve, reject) => result.match(resolve, reject));
}
