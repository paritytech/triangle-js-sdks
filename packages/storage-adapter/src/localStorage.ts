import { createNanoEvents } from 'nanoevents';
import { fromAsyncThrowable } from 'neverthrow';

import { toError } from './helpers.js';
import type { StorageAdapter } from './types.js';

export function createLocalStorageAdapter(prefix: string): StorageAdapter {
  const events = createNanoEvents<Record<string, (value: string | null) => unknown>>();
  const prefixPattern = `PAPP_${prefix}_`;
  const withPrefix = (key: string) => `${prefixPattern}${key}`;

  return {
    write: fromAsyncThrowable(async (key, value) => {
      const prefixedKey = withPrefix(key);
      localStorage.setItem(prefixedKey, value);
      events.emit(prefixedKey, value);
    }, toError),
    read: fromAsyncThrowable(async key => {
      return localStorage.getItem(withPrefix(key));
    }, toError),
    clear: fromAsyncThrowable(async key => {
      const prefixedKey = withPrefix(key);
      localStorage.removeItem(prefixedKey);
      events.emit(prefixedKey, null);
    }, toError),
    clearAll: fromAsyncThrowable(async () => {
      const keysToRemove: string[] = [];

      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith(prefixPattern)) {
          keysToRemove.push(key);
        }
      }

      for (const key of keysToRemove) {
        localStorage.removeItem(key);
        events.emit(key, null);
      }
    }, toError),
    subscribe(key, callback) {
      const prefixedKey = withPrefix(key);
      const unsubscribeLocalListener = events.on(prefixedKey, callback);

      const externalListener = (event: StorageEvent) => {
        if (event.storageArea === localStorage && event.key === prefixedKey) {
          callback(event.newValue);
        }
      };

      window.addEventListener('storage', externalListener);

      return () => {
        unsubscribeLocalListener();
        window.removeEventListener('storage', externalListener);
      };
    },
  };
}
