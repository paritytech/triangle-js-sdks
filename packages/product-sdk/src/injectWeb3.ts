import type { HexString, Transport } from '@novasamatech/host-api';
import { assertEnumVariant, createHostApi, enumValue, fromHex, toHex } from '@novasamatech/host-api';
import { injectExtension } from '@polkadot/extension-inject';
import type { InjectedAccount, InjectedAccounts } from '@polkadot/extension-inject/types';
import type { SignerPayloadJSON, SignerPayloadRaw, SignerResult } from '@polkadot/types/types/extrinsic';
import { AccountId } from 'polkadot-api';

import { createAccountsProvider } from './accounts.js';
import { SpektrExtensionName, Version } from './constants.js';
import { sandboxTransport } from './sandboxTransport.js';

const UNSUPPORTED_VERSION_ERROR = 'Unsupported message version';

/**
 * expected interface derived from specification
 */
export interface TxPayloadV1 {
  /** Payload version. MUST be 1. */
  version: 1;

  /**
   * Signer selection hint. Allows the implementer to identify which private-key / scheme to use.
   * - Use a wallet-defined handle (e.g., address/SS58, account-name, etc). This identifier
   * was previously made available to the consumer.
   * - Set `null` to let the implementer pick the signer (or if the signer is implied).
   */
  signer: string | null;

  /**
   * SCALE-encoded Call (module indicator + function indicator + params).
   */
  callData: HexString;

  /**
   * Transaction extensions supplied by the caller (order irrelevant).
   * The consumer SHOULD provide every extension that is relevant to them.
   * The implementer MAY infer missing ones.
   */
  extensions: Array<{
    /** Identifier as defined in metadata (e.g., "CheckSpecVersion", "ChargeAssetTxPayment"). */
    id: string;

    /**
     * Explicit "extra" to sign (goes into the extrinsic body).
     * SCALE-encoded per the extension's "extra" type as defined in the metadata.
     */
    extra: HexString;

    /**
     * "Implicit" data to sign (known by the chain, not included into the extrinsic body).
     * SCALE-encoded per the extension's "additionalSigned" type as defined in the metadata.
     */
    additionalSigned: HexString;
  }>;

  /**
   * Transaction Extension Version.
   * - For Extrinsic V4 MUST be 0.
   * - For Extrinsic V5, set to any version supported by the runtime.
   * The implementer:
   *  - MUST use this field to determine the required extensions for creating the extrinsic.
   *  - MAY use this field to infer missing extensions that the implementer could know how to handle.
   */
  txExtVersion: number;

  /**
   * Context needed for decoding, display, and (optionally) inferring certain extensions.
   */
  context: {
    /**
     * RuntimeMetadataPrefixed blob (SCALE), starting with ASCII "meta" magic (`0x6d657461`),
     * then a metadata version (V14+). For V5+ versioned extensions, MUST provide V16+.
     */
    metadata: HexString;

    /**
     * Native token display info (used by some implementers), also needed to compute
     * the `CheckMetadataHash` value.
     */
    tokenSymbol: string;
    tokenDecimals: number;

    /**
     * Highest known block number to aid mortality UX.
     */
    bestBlockHeight: number;
  };
}

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
  createTransaction?: (payload: TxPayloadV1) => Promise<HexString>;
}

interface Injected {
  accounts: InjectedAccounts;
  signer: Signer;
}

export async function createLegacyExtensionEnableFactory(transport: Transport) {
  const ready = await transport.isReady();
  if (!ready) return null;

  const accountsManager = createAccountsProvider(transport);
  const hostApi = createHostApi(transport);
  const accountId = AccountId();

  async function enable(): Promise<Injected> {
    async function getAccounts() {
      return await accountsManager
        .getLegacyAccounts()
        .map(response => {
          return response.map<InjectedAccount>(account => ({
            name: account.name,
            address: accountId.dec(account.publicKey),
            type: 'sr25519',
          }));
        })
        .match(
          x => x,
          x => {
            throw x;
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
            signer: raw.address,
            payload:
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
        async signPayload(payload) {
          const codecPayload = {
            signer: payload.address,
            payload: {
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
              signedExtensions: payload.signedExtensions,
              version: payload.version,
            },
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
        async createTransaction(payload) {
          if (payload.version !== 1) {
            throw new Error(`Signer support only v1 transaction, got version = ${payload.version}`);
          }
          const { signer } = payload;
          if (!signer) {
            throw new Error("Signer can't route transaction to the right account without signer hint.");
          }
          const checkGenesis = payload.extensions.find(x => x.id === 'CheckGenesis');
          if (!checkGenesis) {
            throw new Error("Can't find genesis hash on transaction");
          }
          const possibleAccountId = accountId.enc(signer);
          const response = await hostApi.createTransactionWithLegacyAccount(
            enumValue('v1', {
              signer: possibleAccountId,
              genesisHash: fromHex(checkGenesis.extra),
              callData: fromHex(payload.callData),
              txExtVersion: payload.txExtVersion,
              extensions: payload.extensions.map(e => ({
                id: e.id,
                additionalSigned: fromHex(e.additionalSigned),
                extra: fromHex(e.extra),
              })),
            }),
          );

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
    const enable = await createLegacyExtensionEnableFactory(transport);

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
