import type { Logger } from './types.js';

export function createDefaultLogger(msgPrefix?: string): Logger {
  const prefix = msgPrefix ? `[${msgPrefix}]` : '';

  return {
    info: (...args) => console.info(prefix, ...args),
    error: (...args) => console.error(prefix, ...args),
    warn: (...args) => console.warn(prefix, ...args),
    log: (...args) => console.log(prefix, ...args),
  };
}
