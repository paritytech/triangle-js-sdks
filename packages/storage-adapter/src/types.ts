import { ResultAsync } from 'neverthrow';

export type StorageAdapter = {
  write(key: string, value: string): ResultAsync<void, Error>;
  read(key: string): ResultAsync<string | null, Error>;
  clear(key: string): ResultAsync<void, Error>;
  subscribe(key: string, callback: (value: string | null) => unknown): VoidFunction;
};
