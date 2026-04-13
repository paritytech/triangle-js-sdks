import type { SignedStatement, Statement } from '@novasamatech/sdk-statement';
import type { ResultAsync } from 'neverthrow';

export type TopicFilter = { matchAll: Uint8Array[] } | { matchAny: Uint8Array[] };

export type StatementsPage = {
  statements: Statement[];
  isComplete: boolean;
};

export type StatementStoreAdapter = {
  queryStatements(filter: TopicFilter, destination?: Uint8Array): ResultAsync<Statement[], Error>;
  subscribeStatements(filter: TopicFilter, callback: (page: StatementsPage) => unknown): VoidFunction;
  submitStatement(
    statement: SignedStatement,
  ): ResultAsync<
    void,
    | DataTooLargeError
    | ExpiryTooLowError
    | AccountFullError
    | StorageFullError
    | NoProofError
    | BadProofError
    | EncodingTooLargeError
    | NoAllowanceError
    | AlreadyExpiredError
    | KnownExpiredError
    | InternalStoreError
    | Error
  >;
};

export class DataTooLargeError extends Error {
  public readonly submitted: number;
  public readonly available: number;
  constructor(submitted: number, available: number) {
    super(`Submit failed, data too large: ${submitted} > ${available}`);
    this.submitted = submitted;
    this.available = available;
  }
}

export class ExpiryTooLowError extends Error {
  public readonly submitted: bigint;
  public readonly min: bigint;
  constructor(submitted: bigint, min: bigint) {
    super(`Submit failed, expiry too low: ${submitted} < ${min}`);
    this.submitted = submitted;
    this.min = min;
  }
}

export class AccountFullError extends Error {
  public readonly submitted: bigint;
  public readonly min: bigint;
  constructor(submitted: bigint, min: bigint) {
    super(`Submit failed, account full: submitted expiry ${submitted} < min ${min}`);
    this.submitted = submitted;
    this.min = min;
  }
}

export class StorageFullError extends Error {
  constructor() {
    super(`Submit failed, storage is full`);
  }
}

export class NoProofError extends Error {
  constructor() {
    super(`Submit failed, no proof provided`);
  }
}

export class BadProofError extends Error {
  constructor() {
    super(`Submit failed, bad proof provided`);
  }
}

export class EncodingTooLargeError extends Error {
  public readonly submitted: number;
  public readonly max: number;
  constructor(submitted: number, max: number) {
    super(`Submit failed, encoding too large`);
    this.submitted = submitted;
    this.max = max;
  }
}

export class NoAllowanceError extends Error {
  constructor() {
    super(`Submit failed, no allowance set for account`);
  }
}

export class AlreadyExpiredError extends Error {
  constructor() {
    super(`Submit failed, statement already expired`);
  }
}

export class KnownExpiredError extends Error {
  constructor() {
    super(`Submit failed, statement was known but has expired`);
  }
}

export class InternalStoreError extends Error {
  constructor(detail: string) {
    super(`Submit failed, internal store error: ${detail}`);
  }
}
