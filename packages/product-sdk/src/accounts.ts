import type {
  AccountConnectionStatus as AccountConnectionStatusCodec,
  CodecType,
  HexString,
  Subscription,
  Transport,
} from '@novasamatech/host-api';
import {
  CreateProofErr,
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
import { err, ok } from 'neverthrow';
import type { PolkadotSigner } from 'polkadot-api';
import { getPolkadotSignerFromPjs } from 'polkadot-api/pjs-signer';

import { sandboxTransport } from './sandboxTransport.js';

export type ProductAccount = {
  dotNsIdentifier: string;
  derivationIndex: number;
  publicKey: Uint8Array;
};

export type AccountConnectionStatus = CodecType<typeof AccountConnectionStatusCodec>;

const UNSUPPORTED_VERSION_ERROR = 'Unsupported message version';

export const createAccountsProvider = (transport: Transport = sandboxTransport) => {
  const hostApi = createHostApi(transport);

  return {
    getRootAccount() {
      return hostApi
        .accountGetRoot(enumValue('v1', undefined))
        .mapErr(e => e.value)
        .andThen(response => {
          if (isEnumVariant(response, 'v1')) {
            return ok(response.value);
          }
          // @ts-expect-error response.tag is never here
          return err(new RequestCredentialsErr.Unknown({ reason: `Unsupported response version ${response.tag}` }));
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
            return ok(response.value);
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
    getProductAccountSigner(account: ProductAccount): PolkadotSigner {
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
    getLegacyAccountSigner(account: ProductAccount): PolkadotSigner {
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
