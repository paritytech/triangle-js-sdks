import type { StoredUserSession } from '../userSessionRepository.js';

export type PairingStatus =
  | { step: 'none' }
  | { step: 'initial' }
  | { step: 'pairing'; payload: string }
  | { step: 'pending'; stage: string }
  | { step: 'pairingError'; message: string }
  | { step: 'finished'; session: StoredUserSession };
