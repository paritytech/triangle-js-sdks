import type { CodecType, HexString, Transport } from '@novasamatech/host-api';
import {
  CreateProofErr,
  RequestCredentialsErr,
  RingLocation,
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
          const codecPayload = {
            ...payload,
            blockHash: payload.blockHash as HexString,
            blockNumber: payload.blockNumber as HexString,
            era: payload.era as HexString,
            genesisHash: payload.genesisHash as HexString,
            nonce: payload.nonce as HexString,
            method: payload.method as HexString,
            specVersion: payload.specVersion as HexString,
            transactionVersion: payload.transactionVersion as HexString,
            metadataHash: payload.metadataHash as HexString | undefined,
            tip: payload.tip as HexString,
            assetId: payload.assetId as never as HexString | undefined,
            mode: payload.mode,
            withSignedTransaction: payload.withSignedTransaction,
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
          const payload = {
            address: raw.address,
            data:
              raw.type === 'bytes'
                ? {
                    tag: 'Bytes' as const,
                    value: fromHex(raw.data),
                  }
                : {
                    tag: 'Payload' as const,
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
    getNonProductAccountSigner(account: ProductAccount): PolkadotSigner {
      return getPolkadotSignerFromPjs(
        toHex(account.publicKey),
        async payload => {
          const codecPayload = {
            ...payload,
            blockHash: payload.blockHash as HexString,
            blockNumber: payload.blockNumber as HexString,
            era: payload.era as HexString,
            genesisHash: payload.genesisHash as HexString,
            nonce: payload.nonce as HexString,
            method: payload.method as HexString,
            specVersion: payload.specVersion as HexString,
            transactionVersion: payload.transactionVersion as HexString,
            metadataHash: payload.metadataHash as HexString | undefined,
            tip: payload.tip as HexString,
            assetId: payload.assetId as never as HexString | undefined,
            mode: payload.mode,
            withSignedTransaction: payload.withSignedTransaction,
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
          const payload = {
            address: raw.address,
            data:
              raw.type === 'bytes'
                ? {
                    tag: 'Bytes' as const,
                    value: fromHex(raw.data),
                  }
                : {
                    tag: 'Payload' as const,
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
  };
};
