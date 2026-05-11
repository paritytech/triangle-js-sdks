import type {
  AccountConnectionStatus as AccountConnectionStatusCodec,
  CodecType,
  HexString,
  LegacyAccount as LegacyAccountCodec,
  ProductAccountId as ProductAccountIdCodec,
  ProductAccountTransaction,
  Subscription,
  Transport,
} from '@novasamatech/host-api';
import {
  CreateProofErr,
  GetUserIdErr,
  LoginErr,
  RequestCredentialsErr,
  RingLocation,
  SigningPayload,
  SigningPayloadWithoutAccount,
  SigningRawPayload,
  SigningRawPayloadWithoutAccount,
  assertEnumVariant,
  createHostApi,
  enumValue,
  fromHex,
  isEnumVariant,
  toHex,
} from '@novasamatech/host-api';
import { decAnyMetadata, unifyMetadata } from '@polkadot-api/substrate-bindings';
import { err, ok } from 'neverthrow';
import type { PolkadotSigner } from 'polkadot-api';
import { getPolkadotSignerFromPjs } from 'polkadot-api/pjs-signer';

import { sandboxTransport } from './sandboxTransport.js';

export type ProductAccountId = CodecType<typeof ProductAccountIdCodec>;

export type ProductAccount = {
  dotNsIdentifier: string;
  derivationIndex: number;
  publicKey: Uint8Array;
};

export type LegacyAccount = CodecType<typeof LegacyAccountCodec>;

export type AccountConnectionStatus = CodecType<typeof AccountConnectionStatusCodec>;

const UNSUPPORTED_VERSION_ERROR = 'Unsupported message version';

export const createAccountsProvider = (transport: Transport = sandboxTransport) => {
  const hostApi = createHostApi(transport);

  return {
    getUserId() {
      return hostApi
        .getUserId(enumValue('v1', undefined))
        .mapErr(e => e.value)
        .andThen(response => {
          if (isEnumVariant(response, 'v1')) {
            return ok(response.value);
          }
          // @ts-expect-error response.tag is never here
          return err(new GetUserIdErr.Unknown({ reason: `Unsupported response version ${response.tag}` }));
        });
    },
    requestLogin(reason?: string) {
      return hostApi
        .requestLogin(enumValue('v1', reason))
        .mapErr(e => e.value)
        .andThen(response => {
          if (isEnumVariant(response, 'v1')) {
            return ok(response.value);
          }
          // @ts-expect-error response.tag is never here
          return err(new LoginErr.Unknown({ reason: `Unsupported response version ${response.tag}` }));
        });
    },
    getProductAccount(dotNsIdentifier: string, derivationIndex = 0) {
      return hostApi
        .accountGet(enumValue('v1', [dotNsIdentifier, derivationIndex]))
        .mapErr(e => e.value)
        .andThen(response => {
          if (isEnumVariant(response, 'v1')) {
            return ok({
              publicKey: response.value.publicKey,
              dotNsIdentifier,
              derivationIndex,
            } satisfies ProductAccount);
          }
          // @ts-expect-error response.tag is never here
          return err(new RequestCredentialsErr.Unknown({ reason: `Unsupported response version ${response.tag}` }));
        });
    },
    getProductAccountAlias(dotNsIdentifier: string, derivationIndex = 0) {
      return hostApi
        .accountGetAlias(enumValue('v1', [dotNsIdentifier, derivationIndex]))
        .mapErr(e => e.value)
        .andThen(response => {
          if (isEnumVariant(response, 'v1')) {
            return ok(response.value);
          }
          // @ts-expect-error response.tag is never here
          return err(new RequestCredentialsErr.Unknown({ reason: `Unsupported response version ${response.tag}` }));
        });
    },
    getLegacyAccounts() {
      return hostApi
        .getLegacyAccounts(enumValue('v1', undefined))
        .mapErr(e => e.value)
        .andThen(response => {
          if (isEnumVariant(response, 'v1')) {
            return ok(response.value);
          }
          // @ts-expect-error response.tag is never here
          return err(new RequestCredentialsErr.Unknown({ reason: `Unsupported response version ${response.tag}` }));
        });
    },
    createRingVRFProof(
      dotNsIdentifier: string,
      derivationIndex = 0,
      location: CodecType<typeof RingLocation>,
      message: Uint8Array,
    ) {
      return hostApi
        .accountCreateProof(enumValue('v1', [[dotNsIdentifier, derivationIndex], location, message]))
        .mapErr(e => e.value)
        .andThen(response => {
          if (isEnumVariant(response, 'v1')) {
            return ok(response.value);
          }
          // @ts-expect-error response.tag is never here
          return err(new CreateProofErr.Unknown({ reason: `Unsupported response version ${response.tag}` }));
        });
    },

    /**
     * Builds a `PolkadotSigner` that delegates to the host via `host_create_transaction`.
     *
     * The factory is async because `PolkadotSigner.publicKey` must be a synchronous
     * `Uint8Array` on the returned object — it is fetched up front via `host_account_get`.
     */
    getProductAccountSigner(
      account: ProductAccount,
      signerType: 'signPayload' | 'createTransaction' = 'signPayload',
    ): PolkadotSigner {
      const hostApi = createHostApi(transport);
      const productAccountId: ProductAccountId = [account.dotNsIdentifier, account.derivationIndex];

      /**
       * @deprecated added for backward compatibility
       */
      if (signerType === 'signPayload') {
        return getPolkadotSignerFromPjs(
          toHex(account.publicKey),
          async payload => {
            const codecPayload: CodecType<typeof SigningPayload> = {
              account: [account.dotNsIdentifier, account.derivationIndex],
              payload: buildSigningPayloadFields(payload),
            };

            const response = await hostApi.signPayload(enumValue('v1', codecPayload));

            return response.match(
              response => {
                assertEnumVariant(response, 'v1', UNSUPPORTED_VERSION_ERROR);
                return {
                  id: 0,
                  signature: response.value.signature,
                  signedTransaction: response.value.signedTransaction,
                };
              },
              err => {
                assertEnumVariant(err, 'v1', UNSUPPORTED_VERSION_ERROR);
                throw err.value;
              },
            );
          },
          async raw => {
            const payload: CodecType<typeof SigningRawPayload> = {
              account: [account.dotNsIdentifier, account.derivationIndex],
              payload:
                raw.type === 'bytes'
                  ? {
                      tag: 'Bytes',
                      value: fromHex(asHex(raw.data)),
                    }
                  : {
                      tag: 'Payload',
                      value: raw.data,
                    },
            };

            const response = await hostApi.signRaw(enumValue('v1', payload));

            return response.match(
              response => {
                assertEnumVariant(response, 'v1', UNSUPPORTED_VERSION_ERROR);
                return {
                  id: 0,
                  signature: response.value.signature,
                  signedTransaction: response.value.signedTransaction,
                };
              },
              err => {
                assertEnumVariant(err, 'v1', UNSUPPORTED_VERSION_ERROR);
                throw err.value;
              },
            );
          },
        );
      }

      return {
        publicKey: account.publicKey,

        async signTx(callData, signedExtensions, metadata) {
          const decMeta = unifyMetadata(decAnyMetadata(metadata));
          const { version: versions } = decMeta.extrinsic;
          const latestVersion = versions.reduce((acc, v) => Math.max(acc, v), 0);
          const txExtVersion = latestVersion === 4 ? 0 : latestVersion;

          const txPayload: CodecType<typeof ProductAccountTransaction> = {
            signer: productAccountId,
            callData,
            extensions: Object.values(signedExtensions).map(({ identifier, value, additionalSigned }) => ({
              id: identifier,
              extra: value,
              additionalSigned: additionalSigned,
            })),
            txExtVersion,
          };

          const response = await hostApi.createTransaction(enumValue('v1', txPayload));

          return response.match(
            response => {
              assertEnumVariant(response, 'v1', UNSUPPORTED_VERSION_ERROR);
              return response.value;
            },
            err => {
              assertEnumVariant(err, 'v1', UNSUPPORTED_VERSION_ERROR);
              throw err.value;
            },
          );
        },

        async signBytes(data) {
          const response = await hostApi.signRaw(
            enumValue('v1', {
              account: productAccountId,
              payload: { tag: 'Bytes', value: data },
            }),
          );

          return response.match(
            response => {
              assertEnumVariant(response, 'v1', UNSUPPORTED_VERSION_ERROR);
              return fromHex(response.value.signature);
            },
            err => {
              assertEnumVariant(err, 'v1', UNSUPPORTED_VERSION_ERROR);
              throw err.value;
            },
          );
        },
      };
    },
    subscribeAccountConnectionStatus(callback: (status: AccountConnectionStatus) => void): Subscription<void> {
      const subscriber = hostApi.accountConnectionStatusSubscribe(enumValue('v1', undefined), status => {
        if (status.tag === 'v1') {
          callback(status.value);
        }
      });

      return {
        unsubscribe: subscriber.unsubscribe,
        onInterrupt: cb => subscriber.onInterrupt(v => cb(v.value)),
      };
    },
    getLegacyAccountSigner(account: LegacyAccount): PolkadotSigner {
      return getPolkadotSignerFromPjs(
        toHex(account.publicKey),
        async payload => {
          const codecPayload: CodecType<typeof SigningPayloadWithoutAccount> = {
            signer: payload.address,
            payload: buildSigningPayloadFields(payload),
          };

          const response = await hostApi.signPayloadWithLegacyAccount(enumValue('v1', codecPayload));

          return response.match(
            response => {
              assertEnumVariant(response, 'v1', UNSUPPORTED_VERSION_ERROR);
              return {
                id: 0,
                signature: response.value.signature,
                signedTransaction: response.value.signedTransaction,
              };
            },
            err => {
              assertEnumVariant(err, 'v1', UNSUPPORTED_VERSION_ERROR);
              throw err.value;
            },
          );
        },
        async raw => {
          const payload: CodecType<typeof SigningRawPayloadWithoutAccount> = {
            signer: raw.address,
            payload: { tag: 'Bytes', value: fromHex(asHex(raw.data)) },
          };

          const response = await hostApi.signRawWithLegacyAccount(enumValue('v1', payload));

          return response.match(
            response => {
              assertEnumVariant(response, 'v1', UNSUPPORTED_VERSION_ERROR);
              return {
                id: 0,
                signature: response.value.signature,
                signedTransaction: response.value.signedTransaction,
              };
            },
            err => {
              assertEnumVariant(err, 'v1', UNSUPPORTED_VERSION_ERROR);
              throw err.value;
            },
          );
        },
      );
    },
  };
};

export const accounts = createAccountsProvider();

function asHex(v: string): HexString {
  if (v.startsWith('0x')) return v as HexString;
  return `0x${v}`;
}

function buildSigningPayloadFields(payload: {
  blockHash: string;
  blockNumber: string;
  era: string;
  genesisHash: string;
  nonce: string;
  method: string;
  specVersion: string;
  transactionVersion: string;
  metadataHash?: string;
  tip: string;
  assetId?: unknown;
  mode?: number;
  withSignedTransaction?: boolean;
  signedExtensions: string[];
  version: number;
}): CodecType<typeof SigningPayload>['payload'] {
  return {
    blockHash: asHex(payload.blockHash),
    blockNumber: asHex(payload.blockNumber),
    era: asHex(payload.era),
    genesisHash: asHex(payload.genesisHash),
    nonce: asHex(payload.nonce),
    method: asHex(payload.method),
    specVersion: asHex(payload.specVersion),
    transactionVersion: asHex(payload.transactionVersion),
    metadataHash: payload.metadataHash ? asHex(payload.metadataHash) : undefined,
    tip: asHex(payload.tip),
    assetId: payload.assetId !== undefined ? (payload.assetId as never as HexString) : undefined,
    mode: payload.mode,
    withSignedTransaction: payload.withSignedTransaction,
    signedExtensions: payload.signedExtensions,
    version: payload.version,
  };
}
