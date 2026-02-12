import { enumValue } from '@novasamatech/scale';
import type { LazyClient, LocalSessionAccount, StatementStoreAdapter } from '@novasamatech/statement-store';
import {
  createAccountId,
  createEncryption,
  createLocalSessionAccount,
  createRemoteSessionAccount,
  khash,
} from '@novasamatech/statement-store';
import type { Statement } from '@polkadot-api/sdk-statement';
import { mergeUint8, toHex } from '@polkadot-api/utils';
import { generateMnemonic } from '@polkadot-labs/hdkd-helpers';
import { Result, ResultAsync, err, fromPromise, fromThrowable, ok } from 'neverthrow';

import type { DerivedSr25519Account, EncrPublicKey, EncrSecret, SsPublicKey } from '../../crypto.js';
import { createEncrSecret, createSharedSecret, deriveSr25519Account, getEncrPub, stringToBytes } from '../../crypto.js';
import { AbortError } from '../../helpers/abortError.js';
import { createState, readonly } from '../../helpers/state.js';
import { toError } from '../../helpers/utils.js';
import type { Callback } from '../../types.js';
import type { UserSecretRepository } from '../userSecretRepository.js';
import type { StoredUserSession, UserSessionRepository } from '../userSessionRepository.js';
import { createStoredUserSession } from '../userSessionRepository.js';

import { createAttestationService, createSudoAliceVerifier } from './attestationService.js';
import { HandshakeData, HandshakeResponsePayload, HandshakeResponseSensitiveData } from './scale/handshake.js';
import type { AttestationStatus, PairingStatus } from './types.js';

export type AuthComponent = ReturnType<typeof createAuth>;

type Params = {
  metadata: string;
  statementStore: StatementStoreAdapter;
  ssoSessionRepository: UserSessionRepository;
  userSecretRepository: UserSecretRepository;
  lazyClient: LazyClient;
};

export function createAuth({
  metadata,
  statementStore,
  ssoSessionRepository,
  userSecretRepository,
  lazyClient,
}: Params) {
  const attestationStatus = createState<AttestationStatus>({ step: 'none' });
  const pairingStatus = createState<PairingStatus>({ step: 'none' });

  let authResult: ResultAsync<StoredUserSession | null, Error> | null = null;
  let abort: AbortController | null = null;

  function attestAccount(account: DerivedSr25519Account, signal: AbortSignal) {
    const attestationService = createAttestationService(lazyClient);

    const verifier = createSudoAliceVerifier();
    const username = attestationService.claimUsername();

    attestationStatus.write({ step: 'attestation', username });

    return attestationService
      .grantVerifierAllowance(verifier)
      .andThrough(() => processSignal(signal))
      .andThen(() => attestationService.registerLitePerson(username, account, verifier))
      .andThrough(() => processSignal(signal))
      .andTee(() => {
        attestationStatus.write({ step: 'finished' });
      })
      .orTee(e => {
        if (!(e instanceof AbortError)) {
          attestationStatus.write({ step: 'attestationError', message: e.message });
        }
      });
  }

  function handshake(account: DerivedSr25519Account, signal: AbortSignal) {
    const localAccount = createLocalSessionAccount(createAccountId(account.publicKey));

    pairingStatus.write({ step: 'initial' });

    const encrKeys = createEncrKeys(account.entropy);
    const handshakePayload = encrKeys.andThen(({ publicKey }) =>
      createHandshakePayloadV1({
        ssPublicKey: account.publicKey,
        encrPublicKey: publicKey,
        metadata,
      }),
    );
    const handshakeTopic = encrKeys.andThen(({ publicKey }) => createHandshakeTopic(localAccount, publicKey));

    const dataPrepared = Result.combine([handshakePayload, handshakeTopic, encrKeys]).andTee(([payload]) =>
      pairingStatus.write({ step: 'pairing', payload: createDeeplink(payload) }),
    );

    return dataPrepared.asyncAndThen(([, handshakeTopic, encrKeys]) => {
      const pappResponse = waitForStatements<StoredUserSession>(
        callback => statementStore.subscribeStatements([handshakeTopic], callback),
        signal,
        (statements, resolve) => {
          for (const statement of statements) {
            if (!statement.data) continue;

            const session = retrieveSession({
              localAccount,
              encrSecret: encrKeys.secret,
              payload: statement.data.asBytes(),
            }).unwrapOr(null);

            if (session) {
              resolve(session);
              break;
            }
          }
        },
      );

      const secretesSaved = pappResponse.andThen(({ id }) => {
        return userSecretRepository.write(id, {
          ssSecret: account.secret,
          encrSecret: encrKeys.secret,
          entropy: account.entropy,
        });
      });
      // secrets and sso session should be chained, or it can produce an incorrect state
      const userCreated = secretesSaved.andThen(() => pappResponse.andThen(ssoSessionRepository.add));
      const sessionReceived = ResultAsync.combine([userCreated, secretesSaved]).map(([session]) => session);

      return sessionReceived
        .andTee(session => {
          pairingStatus.write(session ? { step: 'finished', session } : { step: 'none' });
        })
        .orTee(e => {
          if (!(e instanceof AbortError)) {
            pairingStatus.write({ step: 'pairingError', message: e.message });
          }
        });
    });
  }

  const authModule = {
    pairingStatus: readonly(pairingStatus),
    attestationStatus: readonly(attestationStatus),

    authenticate(): ResultAsync<StoredUserSession | null, Error> {
      if (authResult) {
        return authResult;
      }

      abort = new AbortController();

      const account = deriveSr25519Account(generateMnemonic(), '//wallet//sso');

      authResult = ResultAsync.combine([handshake(account, abort.signal), attestAccount(account, abort.signal)])
        .map(([session]) => session)
        .orElse(e => (e instanceof AbortError ? ok(null) : err(e)))
        .andTee(() => {
          abort = null;
        })
        .orTee(() => {
          authResult = null;
          abort = null;
        });

      return authResult;
    },

    abortAuthentication() {
      if (abort) {
        abort.abort(new AbortError('Aborted by user.'));
        abort = null;
      }
      authResult = null;
      pairingStatus.reset();
      attestationStatus.reset();
    },
  };

  return authModule;
}

const createHandshakeTopic = fromThrowable(
  (account: LocalSessionAccount, encrPublicKey: EncrPublicKey) =>
    khash(account.accountId, mergeUint8([encrPublicKey, stringToBytes('topic')])),
  toError,
);

const createHandshakePayloadV1 = fromThrowable(
  ({
    encrPublicKey,
    ssPublicKey,
    metadata,
  }: {
    encrPublicKey: EncrPublicKey;
    ssPublicKey: SsPublicKey;
    metadata: string;
  }) => HandshakeData.enc(enumValue('v1', [ssPublicKey, encrPublicKey, metadata])),
  toError,
);

function parseHandshakePayload(payload: Uint8Array) {
  const decoded = HandshakeResponsePayload.dec(payload);

  switch (decoded.tag) {
    case 'v1':
      return decoded.value;
    default:
      throw new Error('Unsupported handshake payload version');
  }
}

const createEncrKeys = fromThrowable((entropy: Uint8Array) => {
  const secret = createEncrSecret(entropy);

  return {
    secret,
    publicKey: getEncrPub(secret),
  };
}, toError);

function retrieveSession({
  payload,
  encrSecret,
  localAccount,
}: {
  payload: Uint8Array;
  encrSecret: EncrSecret;
  localAccount: LocalSessionAccount;
}): Result<StoredUserSession, Error> {
  const { encrypted, tmpKey } = parseHandshakePayload(payload);

  const symmetricKey = createSharedSecret(encrSecret, tmpKey);

  return createEncryption(symmetricKey)
    .decrypt(encrypted)
    .map(decrypted => {
      const [pappEncrPublicKey, pappAccountId] = HandshakeResponseSensitiveData.dec(decrypted);
      const sharedSecret = createSharedSecret(encrSecret, pappEncrPublicKey);

      const peerAccount = createRemoteSessionAccount(createAccountId(pappAccountId), sharedSecret);

      return createStoredUserSession(localAccount, peerAccount);
    });
}

function createDeeplink(payload: Uint8Array) {
  return `polkadotapp://pair?handshake=${toHex(payload)}`;
}

function waitForStatements<T>(
  subscribe: (callback: Callback<Statement[]>) => VoidFunction,
  signal: AbortSignal,
  callback: (statements: Statement[], resolve: (value: T) => void) => void,
): ResultAsync<T, Error> {
  return fromPromise(
    new Promise<T>((resolve, reject) => {
      const unsubscribe = subscribe(statements => {
        const abortError = processSignal(signal).match(
          () => null,
          e => e,
        );

        if (abortError) {
          unsubscribe();
          reject(abortError);
          return;
        }

        try {
          callback(statements, value => {
            unsubscribe();
            resolve(value);
          });
        } catch (e) {
          unsubscribe();
          reject(e);
        }
      });
    }),
    toError,
  );
}

function processSignal(signal: AbortSignal) {
  try {
    signal.throwIfAborted();
    return ok<void>();
  } catch (e) {
    return err(toError(e));
  }
}
