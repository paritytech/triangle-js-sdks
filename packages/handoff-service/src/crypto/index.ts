export type { FileEncryption } from './encryption.js';
export { createFileEncryption } from './encryption.js';

export type { FileTicket } from './ticket.js';
export {
  deriveEncryptionKey,
  derivePublicKey,
  deriveSigningKeypair,
  deriveSigningSeed,
  generateTicket,
  signWithTicket,
} from './ticket.js';
