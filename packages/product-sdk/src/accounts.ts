import type {
  AccountConnectionStatus as AccountConnectionStatusCodec,
  CodecType,
  HexString,
  Transport,
} from '@novasamatech/host-api';
import {
  CreateProofErr,
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
import { getPolkadotSignerFromPjs } from '@polkadot-api/pjs-signer';
import { err, ok } from 'neverthrow';
import type { PolkadotSigner } from 'polkadot-api';

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
    getNonProductAccounts() {
      return hostApi
        .getNonProductAccounts(enumValue('v1', undefined))
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
            payload: {
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
            },
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
    subscribeAccountConnectionStatus(callback: (status: AccountConnectionStatus) => void) {
      return hostApi.accountConnectionStatusSubscribe(enumValue('v1', undefined), status => {
        if (status.tag === 'v1') {
          callback(status.value);
        }
      });
    },
    getNonProductAccountSigner(account: ProductAccount): PolkadotSigner {
      return getPolkadotSignerFromPjs(
        toHex(account.publicKey),
        async payload => {
          const codecPayload: CodecType<typeof SigningPayloadWithoutAccount> = {
            signer: payload.address,
            payload: {
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
            },
          };

          const response = await hostApi.signPayloadWithNonProductAccount(enumValue('v1', codecPayload));

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

          const response = await hostApi.signRawWithNonProductAccount(enumValue('v1', payload));

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
