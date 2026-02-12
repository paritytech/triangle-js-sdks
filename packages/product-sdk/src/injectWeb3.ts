import type { CodecType, HexString, Transport, VersionedPublicTxPayload } from '@novasamatech/host-api';
import { assertEnumVariant, createHostApi, enumValue, fromHex, toHex } from '@novasamatech/host-api';
import { injectExtension } from '@polkadot/extension-inject';
import type { InjectedAccount, InjectedAccounts } from '@polkadot/extension-inject/types';
import type { SignerPayloadJSON, SignerPayloadRaw, SignerResult } from '@polkadot/types/types/extrinsic';
import { AccountId } from '@polkadot-api/substrate-bindings';

import { SpektrExtensionName, Version } from './constants.js';
import { sandboxTransport } from './sandboxTransport.js';

const UNSUPPORTED_VERSION_ERROR = 'Unsupported message version';

interface Signer {
  /**
   * @description signs an extrinsic payload from a serialized form
   */
  signPayload?: (payload: SignerPayloadJSON) => Promise<SignerResult>;
  /**
   * @description signs a raw payload, only the bytes data as supplied
   */
  signRaw?: (raw: SignerPayloadRaw) => Promise<SignerResult>;
  /**
   * @description signs a transaction according to https://github.com/polkadot-js/api/issues/6213
   */
  createTransaction?: (payload: CodecType<typeof VersionedPublicTxPayload>) => Promise<HexString>;
}

interface Injected {
  accounts: InjectedAccounts;
  signer: Signer;
}

export async function createNonProductExtensionEnableFactory(transport: Transport) {
  const ready = await transport.isReady();
  if (!ready) return null;

  const hostApi = createHostApi(transport);
  const accountId = AccountId();

  async function enable(): Promise<Injected> {
    async function getAccounts() {
      const response = await hostApi.getNonProductAccounts(enumValue('v1', undefined));

      return response.match(
        response => {
          assertEnumVariant(response, 'v1', UNSUPPORTED_VERSION_ERROR);

          return response.value.map<InjectedAccount>(account => ({
            name: account.name,
            address: accountId.dec(account.publicKey),
            type: 'sr25519',
          }));
        },
        err => {
          assertEnumVariant(err, 'v1', UNSUPPORTED_VERSION_ERROR);
          throw err.value;
        },
      );
    }

    return {
      accounts: {
        async get() {
          return getAccounts();
        },
        subscribe(callback) {
          getAccounts().then(callback);
          return () => {
            // empty
          };
        },
      },

      signer: {
        async signRaw(raw) {
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
        async signPayload(payload) {
          const codecPayload = {
            ...payload,
            method: payload.method as HexString,
            assetId: payload.assetId,
            mode: payload.mode,
            withSignedTransaction: payload.withSignedTransaction,
            metadataHash: payload.metadataHash,
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
        async createTransaction(payload) {
          const response = await hostApi.createTransactionWithNonProductAccount(enumValue('v1', payload));

          return response.match<HexString, HexString>(
            response => {
              assertEnumVariant(response, 'v1', UNSUPPORTED_VERSION_ERROR);
              return toHex(response.value);
            },
            err => {
              assertEnumVariant(err, 'v1', UNSUPPORTED_VERSION_ERROR);
              throw err.value;
            },
          );
        },
      },
    };
  }

  return enable;
}

export async function injectSpektrExtension(transport: Transport | null = sandboxTransport) {
  if (!transport) return false;

  try {
    const enable = await createNonProductExtensionEnableFactory(transport);

    if (enable) {
      injectExtension(enable, { name: SpektrExtensionName, version: Version });
      return true;
    } else {
      return false;
    }
  } catch (e) {
    transport.provider.logger.error('Error injecting extension', e);
    return false;
  }
}
