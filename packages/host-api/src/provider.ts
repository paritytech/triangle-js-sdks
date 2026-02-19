import type { Logger } from './types.js';

declare namespace Provider {
  export interface LoggerOptions {
    readonly msgPrefix?: string;
  }
}

export type Provider = {
  /**
   * @deprecated Use `defaultLogger` for the default logger instance,
   * or `getLogger(options)` to create a configured logger with a custom message prefix.
   */
  readonly logger: Logger;
  readonly defaultLogger: Logger;
  getLogger(options: Provider.LoggerOptions): Logger;
  isCorrectEnvironment(): boolean;
  postMessage(message: Uint8Array): void;
  subscribe(callback: (message: Uint8Array) => void): () => void;
  dispose(): void;
};
