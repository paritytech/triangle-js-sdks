/**
 * Orchestrates a single V2 SSO pairing exchange.
 *
 * Wires the codec, envelope, topic, and state-machine pieces together:
 *   1. Encode the device's `VersionedHandshakeProposal::V2` and build the
 *      `polkadotapp://pair?handshake=<hex>` deeplink (consumed by the QR UI).
 *   2. Compute the pairing topic from the device pubkeys and subscribe to the
 *      Statement Store on it.
 *   3. For each incoming statement: SCALE-decode `VersionedHandshakeResponse`,
 *      pull out the `V2` envelope, ECDH-decrypt the inner payload using the
 *      device's encryption private key, SCALE-decode `EncryptedHandshakeResponseV2`,
 *      and feed the result through the state machine via `fromInnerResponse` +
 *      `advance`.
 *   4. On `Success`, invoke the caller-supplied `persistOnSuccess` and stop.
 *
 * The chain RPC subscription only delivers a statement once when it first
 * appears on a topic; channel replacements (Pending → Success on the same
 * channel) don't reliably get re-broadcast as new events. So the service also
 * polls `queryStatements` every 2s alongside the live subscription. Polling
 * stops on terminal state and on `abort()`.
 *
 * Returns an Observable of `HandshakeState` and an `abort()` for cleanup —
 * higher layers drive a UI hook off this and update an onboarding screen.
 */

import type { Statement, StatementStoreAdapter } from '@novasamatech/statement-store';
import type { Observable } from 'rxjs';
import { BehaviorSubject } from 'rxjs';

import { EncryptedHandshakeResponseV2, VersionedHandshakeResponse } from '../scale/handshakeV2.js';

import { decryptResponseEnvelope } from './envelope.js';
import type { HandshakeMetadata } from './proposal.js';
import { buildPairingDeeplink } from './proposal.js';
import type { HandshakeState, HandshakeSuccessState } from './state.js';
import { advance, fromInnerResponse, isTerminal, submitted } from './state.js';
import { computePairingTopic } from './topic.js';

export type DeviceIdentityForPairing = {
  statementAccountPublicKey: Uint8Array;
  /**
   * sr25519 secret for the device statement account. `startPairingV2` itself
   * doesn't sign anything, but the post-pairing `StoredUserSession` needs it
   * so the V1 sessionManager prover can issue session statements.
   */
  statementAccountSecret: Uint8Array;
  encryptionPublicKey: Uint8Array;
  encryptionPrivateKey: Uint8Array;
};

export type StartPairingDeps = {
  statementStore: StatementStoreAdapter;
  deviceIdentity: DeviceIdentityForPairing;
  metadata: HandshakeMetadata;
  persistOnSuccess?: (success: HandshakeSuccessState) => Promise<void>;
  /**
   * Hex of a previously-processed statement. The service will skip statements
   * whose bytes match this value, treating them as already-handled. Useful for
   * surviving page reloads / logouts so a stale Success on chain doesn't get
   * replayed before the user re-authenticates.
   */
  initialProcessedDataHex?: string | null;
  /**
   * Fires whenever the service starts processing a new statement (i.e. after
   * the byte-level dedupe passes). Callers persist the hex so the next
   * `initialProcessedDataHex` value is up to date.
   */
  onStatementProcessed?: (dataHex: string) => void;
  /**
   * Turns on logging for statement store interaction
   */
  __DEBUG?: boolean;
};

export type Pairing = {
  qrPayload: string;
  state$: Observable<HandshakeState>;
  abort: () => void;
};

const DEFAULT_POLL_INTERVAL_MS = 2_000;

const toHexFull = (bytes: Uint8Array) => {
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return `0x${out}`;
};

const fromHexString = (hex: string): Uint8Array => {
  const stripped = hex.startsWith('0x') ? hex.slice(2) : hex;
  const out = new Uint8Array(stripped.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(stripped.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
};

const extractStatementSigner = (statement: Statement): Uint8Array | null => {
  const proof = statement.proof;
  if (!proof) return null;
  if (proof.type !== 'sr25519' && proof.type !== 'ed25519') return null;
  try {
    return fromHexString(proof.value.signer);
  } catch {
    return null;
  }
};

export const startPairingV2 = (deps: StartPairingDeps): Pairing => {
  const persistOnSuccess = deps.persistOnSuccess;

  const qrPayload = buildPairingDeeplink(
    {
      statementAccountPublicKey: deps.deviceIdentity.statementAccountPublicKey,
      encryptionPublicKey: deps.deviceIdentity.encryptionPublicKey,
    },
    deps.metadata,
  );

  const state$ = new BehaviorSubject<HandshakeState>(submitted());
  const topic = computePairingTopic(
    deps.deviceIdentity.statementAccountPublicKey,
    deps.deviceIdentity.encryptionPublicKey,
  );

  let aborted = false;
  let unsubscribe: (() => void) | null = null;
  let pollHandle: ReturnType<typeof setInterval> | null = null;
  let lastProcessedDataHex: string | null = deps.initialProcessedDataHex ?? null;

  const stopPolling = () => {
    if (pollHandle === null) return;
    clearInterval(pollHandle);
    pollHandle = null;
  };

  const log = (msg: string, extra?: unknown) => {
    if (!deps.__DEBUG) return;
    if (extra === undefined) console.info(`[sso-v2] ${msg}`);
    else console.info(`[sso-v2] ${msg}`, extra);
  };

  // One-shot probe: query the topic right away so we know whether any answer
  // statement was already posted before our subscription connected.
  void deps.statementStore.queryStatements({ matchAll: [topic] }).match(
    statements => log(`queryStatements probe: ${statements.length} statement(s)`),
    err => log('queryStatements probe failed', err),
  );

  const handleStatement = (statement: Statement) => {
    if (aborted || isTerminal(state$.value)) return;
    if (!statement.data) return;
    const dataHex = toHexFull(statement.data);
    if (dataHex === lastProcessedDataHex) return;
    lastProcessedDataHex = dataHex;
    deps.onStatementProcessed?.(dataHex);
    log(`statement received, ${statement.data.length}-byte payload`);

    let envelope: { encrypted: Uint8Array; tmpKey: Uint8Array };
    try {
      const decoded = VersionedHandshakeResponse.dec(statement.data);
      if (decoded.tag !== 'V2') {
        log(`response is not V2 (tag=${decoded.tag}) — dropping`);
        return;
      }
      envelope = decoded.value;
    } catch (err) {
      log('VersionedHandshakeResponse.dec threw — dropping', err);
      return;
    }

    let innerBytes: Uint8Array;
    try {
      innerBytes = decryptResponseEnvelope(deps.deviceIdentity.encryptionPrivateKey, envelope);
    } catch (err) {
      log('outer envelope decrypt failed — wrong recipient or tampered', err);
      return;
    }

    const peerStatementAccountId = extractStatementSigner(statement);

    let next: HandshakeState;
    try {
      next = fromInnerResponse(EncryptedHandshakeResponseV2.dec(innerBytes), peerStatementAccountId);
    } catch (err) {
      log(`inner decode failed; innerBytes (${innerBytes.length}b) = ${toHexFull(innerBytes)}`, err);
      return;
    }

    log(`decoded inner response, tag=${next.tag}`);
    if (next.tag === 'Failed') {
      log(`failure reason: "${next.reason}" (innerBytes ${innerBytes.length}b = ${toHexFull(innerBytes)})`);
    }

    const advanced = advance(state$.value, next);
    if (advanced === state$.value) {
      // Same-tag idempotence is the common case (every poll re-fetches the
      // current statement); only log when a transition was actually rejected
      // for protocol-state reasons (e.g. Success → Pending).
      if (advanced.tag !== next.tag) {
        log(`advance() rejected ${state$.value.tag} → ${next.tag} — dropping`);
      }
      return;
    }
    log(`state ${state$.value.tag} → ${advanced.tag}`);
    state$.next(advanced);

    if (advanced.tag === 'Success' && persistOnSuccess !== undefined) {
      void persistOnSuccess(advanced).catch(err => {
        console.warn('persistHandshakeSuccess failed', err);
      });
    }

    if (isTerminal(advanced)) {
      stopPolling();
    }
  };

  unsubscribe = deps.statementStore.subscribeStatements({ matchAll: [topic] }, page => {
    log(`subscription page: ${page.statements.length} statement(s), isComplete=${page.isComplete}`);
    for (const stmt of page.statements) handleStatement(stmt);
  });

  // Poll because the chain RPC subscription doesn't deliver channel
  // replacements as new events. handleStatement dedupes on data bytes so
  // re-fetching the same Pending tick after tick is silent.
  pollHandle = setInterval(() => {
    if (aborted || isTerminal(state$.value)) return;
    deps.statementStore.queryStatements({ matchAll: [topic] }).match(
      statements => {
        for (const stmt of statements) handleStatement(stmt);
      },
      err => log('poll queryStatements failed', err),
    );
  }, DEFAULT_POLL_INTERVAL_MS);

  return {
    qrPayload,
    state$: state$.asObservable(),
    abort: () => {
      if (aborted) return;
      aborted = true;
      stopPolling();
      unsubscribe?.();
      unsubscribe = null;
      state$.complete();
    },
  };
};
