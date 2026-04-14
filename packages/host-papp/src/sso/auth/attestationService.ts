import type { LazyClient } from '@novasamatech/statement-store';
import { createAccountId } from '@novasamatech/statement-store';
import { mergeUint8 } from '@polkadot-api/utils';
import { blake2b256 } from '@polkadot-labs/hdkd-helpers';
import { customAlphabet } from 'nanoid';
import type { ResultAsync } from 'neverthrow';
import { errAsync, fromAsyncThrowable, fromPromise, okAsync } from 'neverthrow';
import { AccountId, Binary } from 'polkadot-api';
import type { PolkadotSigner } from 'polkadot-api/signer';
import { getPolkadotSigner } from 'polkadot-api/signer';
import { Bytes, Option, Tuple, str } from 'scale-ts';
import { member_from_entropy, sign } from 'verifiablejs/bundler';

import type { People_lite } from '../../../.papi/descriptors/dist/index.js';
import type { DerivedSr25519Account, EncrSecret } from '../../crypto.js';
import { deriveSr25519Account, getEncrPub, stringToBytes } from '../../crypto.js';
import { toError } from '../../helpers/utils.js';

const accountId = AccountId();

export function createSudoAliceVerifier(): DerivedSr25519Account {
  return deriveSr25519Account('bottom drive obey lake curtain smoke basket hold race lonely fit walk', '//Alice');
}

export function withRetry<T>(fn: () => Promise<T>, maxRetries = 1): Promise<T> {
  return fn().catch(error => {
    if (maxRetries > 0) {
      return withRetry(fn, maxRetries - 1);
    }
    throw error;
  });
}

export const createAttestationService = (lazyClient: LazyClient) => {
  const service = {
    claimUsername() {
      const nameSuffixFactory = customAlphabet('abcdefghijklmnopqrstuvwxyz', 4);

      return `guest${nameSuffixFactory()}.${createNumericSuffix(4)}`;
    },

    grantVerifierAllowance(verifier: DerivedSr25519Account): ResultAsync<void, Error> {
      const client = lazyClient.getClient();
      const api = client.getUnsafeApi<People_lite>();
      const verifierAddress = accountId.dec(verifier.publicKey);

      if (!api.query.PeopleLite || !api.query.PeopleLite.AttestationAllowance) {
        return errAsync(new Error('Query PeopleLite.AttestationAllowance not found.'));
      }

      const verifierAllowance = fromPromise(
        api.query.PeopleLite.AttestationAllowance.getValue(verifierAddress),
        toError,
      );

      const getAllowance = fromAsyncThrowable(async () => {
        const increaseAllowanceCall = api.tx.PeopleLite.increase_attestation_allowance({
          account: verifierAddress,
          count: 10,
        });

        const sudoCall = api.tx.Sudo.sudo({
          call: increaseAllowanceCall.decodedCall,
        });

        return withRetry(() =>
          sudoCall.signAndSubmit(createPeopleSigner(verifier), { at: 'best' }).then(() => undefined),
        );
      }, toError);

      return verifierAllowance.andThen(verifierAllowance => (verifierAllowance > 0 ? okAsync() : getAllowance()));
    },

    getRingRfKey(candidate: DerivedSr25519Account) {
      const verifiableEntropy = blake2b256(candidate.entropy);
      return member_from_entropy(verifiableEntropy);
    },

    getProofMessage(candidate: DerivedSr25519Account, ringVrfKey: Uint8Array) {
      return mergeUint8([stringToBytes('pop:people-lite:register using'), candidate.publicKey, ringVrfKey]);
    },

    deriveAttestationParams(username: string, candidate: DerivedSr25519Account, verifier: DerivedSr25519Account) {
      const verifiableEntropy = blake2b256(candidate.entropy);
      const ringVrfKey = service.getRingRfKey(candidate);
      const identifierKey = getEncrPub(blake2b256(candidate.secret) as EncrSecret);

      const message = service.getProofMessage(candidate, ringVrfKey);

      // Extract username without the `.` separator and any following digits
      // For lite person usernames like "ceainnhgidpj.39642086", we only use "ceainnhgidpj"
      const usernameWithoutDigits = username.split('.')[0] ?? username;

      const candidateSignature = candidate.sign(message);
      const proofOfOwnership = sign(verifiableEntropy, message);

      const ResourceSignatureCodec = Tuple(
        // candidate PublicKey (32 bytes)
        Bytes(32),
        // verifier AccountId (32 bytes)
        Bytes(32),
        // identifierKey
        Bytes(65),
        // username without digits
        str,
        // reserved_username
        Option(Bytes()),
      );

      const resourcesSignatureData = ResourceSignatureCodec.enc([
        candidate.publicKey,
        createAccountId(verifier.publicKey),
        identifierKey,
        usernameWithoutDigits,
        undefined,
      ]);

      const consumerRegistrationSignature = candidate.sign(resourcesSignatureData);

      return okAsync({
        candidateSignature: candidateSignature,
        ringVrfKey,
        proofOfOwnership,
        identifierKey,
        consumerRegistrationSignature,
      });
    },

    registerLitePerson(username: string, candidate: DerivedSr25519Account, verifier: DerivedSr25519Account) {
      const client = lazyClient.getClient();
      const api = client.getUnsafeApi<People_lite>();

      return service
        .deriveAttestationParams(username, candidate, verifier)
        .andThen(params => {
          const attestCall = api.tx.PeopleLite.attest({
            candidate: accountId.dec(candidate.publicKey),
            candidate_signature: {
              type: 'Sr25519',
              value: Binary.fromBytes(params.candidateSignature),
            },
            ring_vrf_key: Binary.fromBytes(params.ringVrfKey),
            proof_of_ownership: Binary.fromBytes(params.proofOfOwnership),
            consumer_registration: {
              signature: {
                type: 'Sr25519',
                value: Binary.fromBytes(params.consumerRegistrationSignature),
              },
              account: accountId.dec(candidate.publicKey),
              identifier_key: Binary.fromBytes(params.identifierKey),
              username: Binary.fromText(username),
              reserved_username: undefined,
            },
          });

          const submitAttestation = () =>
            new Promise<void>((resolve, reject) => {
              const subscription = attestCall
                .signSubmitAndWatch(createPeopleSigner(verifier), { at: 'best' })
                .subscribe({
                  next(event) {
                    if ((event.type === 'txBestBlocksState' && event.found) || event.type === 'finalized') {
                      subscription.unsubscribe();
                      if (event.ok) {
                        resolve();
                      } else {
                        let errorMessage = 'Transaction failed';
                        if (event.dispatchError?.type === 'Module') {
                          const moduleError = event.dispatchError.value as any;
                          errorMessage = `${moduleError.type}.${moduleError.value?.type || 'Unknown'}`;
                        }
                        reject(new Error(errorMessage));
                      }
                    }
                  },
                  error: reject,
                  complete: () => reject(new Error('Transaction observable completed without best block confirmation')),
                });
            });

          return fromPromise(withRetry(submitAttestation), toError).map<void>(() => undefined);
        })
        .andTee(() => console.log(`Attestation for ${accountId.dec(candidate.publicKey)} successfully passed.`));
    },
  };

  return service;
};

function createNumericSuffix(length: number) {
  let suffix = '';
  for (let i = 0; i < length; i++) {
    suffix += (Math.random() * 9).toFixed();
  }
  return suffix;
}

function createPeopleSigner(verifier: DerivedSr25519Account): PolkadotSigner {
  const baseSigner = getPolkadotSigner(verifier.publicKey, 'Sr25519', verifier.sign);

  return {
    publicKey: baseSigner.publicKey,
    signBytes: baseSigner.signBytes,
    signTx: async (callData, signedExtensions, metadata, atBlockNumber, hasher) => {
      // Add People chain custom signed extensions
      const extensionsWithCustom = {
        ...signedExtensions,
        VerifyMultiSignature: {
          identifier: 'VerifyMultiSignature',
          value: new Uint8Array([1]), // 1u8 = Option::Some with empty data
          additionalSigned: new Uint8Array([]), // Empty additional data
        },
        AsPerson: {
          identifier: 'AsPerson',
          value: new Uint8Array([0]), // 0u8 = Option::None
          additionalSigned: new Uint8Array([]), // Empty additional data
        },
      };

      return baseSigner.signTx(callData, extensionsWithCustom, metadata, atBlockNumber, hasher);
    },
  };
}
