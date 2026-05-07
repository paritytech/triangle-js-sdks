import type { ResultAsync } from 'neverthrow';
import { okAsync } from 'neverthrow';

import { nonNullable } from './helpers.js';
import type { StorageAdapter } from './types.js';

type Params<T> = {
  storage: StorageAdapter;
  key: string;
  initial: T;
  autosync?: boolean;
  from(value: string): T;
  to(value: T): string | null;
};

export function fieldView<T>({ storage, initial, key, from, to, autosync = true }: Params<T>) {
  const enhancedStorage = {
    read() {
      return storage.read(key).map(x => (nonNullable(x) ? from(x) : initial));
    },

    write(value: T) {
      const data = to(value);

      // `to` returning null means "no representation"; clear the key so
      // persisted state stays in sync with `value`.
      if (data === null) {
        return storage.clear(key).map(() => null);
      }

      return storage.write(key, data).map(() => value);
    },

    clear() {
      return storage.clear(key);
    },

    subscribe(fn: (value: T) => void) {
      if (autosync) {
        enhancedStorage.read().andTee(fn);
      }

      return storage.subscribe(key, x => fn(nonNullable(x) ? from(x) : initial));
    },
  };

  if (autosync) {
    enhancedStorage.read();
  }

  return enhancedStorage;
}

export function fieldListView<T>(params: Omit<Params<T[]>, 'initial'>) {
  const view = fieldView({ ...params, initial: [] });

  const listView = {
    ...view,

    add(value: T): ResultAsync<T, Error> {
      return listView.mutate(list => list.concat(value)).map(() => value);
    },

    filter(fn: (value: T) => boolean): ResultAsync<T[], Error> {
      return listView.mutate(list => {
        const filtered = list.filter(fn);
        return filtered.length === list.length ? list : filtered;
      });
    },

    mutate(fn: (value: T[]) => T[]): ResultAsync<T[], Error> {
      return listView.read().andThen(list => {
        const result = fn(list);
        if (result === list) return okAsync(result);
        return listView.write(result).map(() => result);
      });
    },
  };

  return listView;
}
