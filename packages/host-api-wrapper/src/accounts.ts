import type {
  AccountConnectionStatus as AccountConnectionStatusCodec,
  AccountSelector,
  CodecType,
  HexString,
  LegacyAccount as LegacyAccountCodec,
  ProductAccountId as ProductAccountIdCodec,
  ProductAccountTransaction,
  RegisteredRingVrfKey as RegisteredRingVrfKeyCodec,
  RingVrfKeyDisclosure as RingVrfKeyDisclosureCodec,
  RingVrfKeyHandle as RingVrfKeyHandleCodec,
  Subscription,
  Transport,
  VrfTranscriptItem as VrfTranscriptItemCodec,
} from '@novasamatech/host-api';
import {
  CreateProofErr,
  GetAliasErr,
  GetUserIdErr,
  ListRingVrfKeysErr,
  LoginErr,
  ProductProofContext,
  RegisterRingVrfKeyErr,
  RequestCredentialsErr,
  RingLocation,
  RingVrfSignErr,
  SignVrfErr,
  SigningPayload,
  SigningPayloadWithoutAccount,
  SigningRawPayload,
  SigningRawPayloadWithoutAccount,
  assertEnumVariant,
  createHostApi,
  derivationIndexOf,
  enumValue,
  fromHex,
  isEnumVariant,
  toHex,
} from '@novasamatech/host-api';
import { createV4Tx } from '@polkadot-api/signers-common';
import { decAnyMetadata, unifyMetadata } from '@polkadot-api/substrate-bindings';
import { err, ok } from 'neverthrow';
import { AccountId } from 'polkadot-api';
import { getTxCreatorFromPjs } from 'polkadot-api/pjs-signer';
import type { SignerTxCreator } from 'polkadot-api/tx-creator';

/** v3 `TxPayloadV1`, taken from the `TxCreator` call signature (not exported directly). */
type TxPayloadV1 = Parameters<SignerTxCreator>[0];

import { sandboxTransport } from './sandboxTransport.js';

export type { AccountSelector } from '@novasamatech/host-api';

export type ProductAccountId = CodecType<typeof ProductAccountIdCodec>;

export type ProductAccount = {
  dotNsIdentifier: string;
  /**
   * Account selector within the product subtree (RFC 0022): a plain index or a
   * raw 32-byte index.
   */
  derivationIndex: AccountSelector;
  publicKey: Uint8Array;
};

/**
 * Product-scoped proof context (RFC 0004, amended by RFC 0022): the product id
 * plus a selector that expands to the same 32-byte derivation index as a
 * product account's.
 */
export type ProofContext = [productId: string, suffix: AccountSelector];

/**
 * Public name of a registered ring VRF key (RFC-0024).
 *
 * Deliberately kept in wire form: the index is the owning product's
 * implementation detail, so a handle obtained from {@link
 * createAccountsProvider}'s `listRingVrfKeys` must be passed through opaquely.
 * **Never hardcode another product's index** — select by declared ring instead;
 * hardcoding breaks the moment the owner rotates or adds a key. Use
 * {@link ringVrfKeyHandle} to name a key your own product owns.
 */
export type RingVrfKeyHandle = CodecType<typeof RingVrfKeyHandleCodec>;

/** A ring VRF key registry entry (RFC-0024). */
export type RegisteredRingVrfKey = CodecType<typeof RegisteredRingVrfKeyCodec>;

/** How much of a registry entry to ask for: `'Anonymized'` or `'PublicKey'` (RFC-0024). */
export type RingVrfKeyDisclosure = CodecType<typeof RingVrfKeyDisclosureCodec>;

/**
 * Builds a {@link RingVrfKeyHandle} for a key inside `owner`'s ring VRF domain.
 *
 * Intended for naming your *own* keys — the ones you passed to
 * `registerRingVrfKey`. For a foreign key, take the handle from
 * `listRingVrfKeys` instead of constructing one.
 */
export function ringVrfKeyHandle(owner: string, index: AccountSelector): RingVrfKeyHandle {
  return [owner, derivationIndexOf(index)];
}

export type LegacyAccount = CodecType<typeof LegacyAccountCodec>;

export type AccountConnectionStatus = CodecType<typeof AccountConnectionStatusCodec>;

/** One `transcript.append_message(label, value)` call replayed by the host (RFC-0023). */
export type VrfTranscriptItem = CodecType<typeof VrfTranscriptItemCodec>;

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
    getProductAccount(dotNsIdentifier: string, derivationIndex: AccountSelector = 0) {
      return hostApi
        .accountGet(enumValue('v1', [dotNsIdentifier, derivationIndexOf(derivationIndex)]))
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
    /**
     * Registers a ring VRF key this product owns, declaring the ring it is
     * intended for (RFC-0024).
     *
     * Ownership is the calling product, never a parameter, so this is
     * permissionless and prompt-free. Registering the same `index` for another
     * `ring` extends the existing entry rather than creating a second one.
     *
     * Registration declares *intent*, not membership: it says "this is the key
     * I will use for that ring", not "the user is a person". Membership is
     * still discovered only by attempting a proof.
     */
    registerRingVrfKey(index: AccountSelector, ring: CodecType<typeof RingLocation>) {
      return hostApi
        .accountRegisterRingVrfKey(enumValue('v1', [derivationIndexOf(index), ring]))
        .mapErr(e => e.value)
        .andThen(response => {
          if (isEnumVariant(response, 'v1')) {
            return ok(response.value);
          }
          // @ts-expect-error response.tag is never here
          return err(new RegisterRingVrfKeyErr.Unknown({ reason: `Unsupported response version ${response.tag}` }));
        });
    },

    /**
     * Lists the ring VRF registry entries owned by `owner` — this product or
     * another one (RFC-0024).
     *
     * Listing your own keys is permissionless; a foreign `owner` needs a grant
     * or produces a user prompt. `'PublicKey'` disclosure additionally returns
     * the member public key, which is linkable across every ring it appears in
     * and so is permissioned cross-product.
     *
     * Select the entry you want by the rings it declares, never by index.
     */
    listRingVrfKeys(owner: string, disclosure: RingVrfKeyDisclosure = 'Anonymized') {
      return hostApi
        .accountListRingVrfKeys(enumValue('v1', [owner, disclosure]))
        .mapErr(e => e.value)
        .andThen(response => {
          if (isEnumVariant(response, 'v1')) {
            return ok(response.value);
          }
          // @ts-expect-error response.tag is never here
          return err(new ListRingVrfKeysErr.Unknown({ reason: `Unsupported response version ${response.tag}` }));
        });
    },

    /**
     * Reads the contextual alias `keyHandle` resolves to under `context` in `ring`
     * (RFC-0004, amended by RFC-0024).
     *
     * `ring` stays explicit even though the handle carries its declared rings,
     * because a key may be registered for several and the caller must say which
     * the alias is against; the host fails with `KeyNotInRing` otherwise.
     *
     * Check `ringRevision` on each use of the resulting alias and renew when it
     * has moved — nothing else watches for it.
     */
    getContextualAlias(keyHandle: RingVrfKeyHandle, context: ProofContext, ring: CodecType<typeof RingLocation>) {
      return hostApi
        .accountGetAlias(enumValue('v1', [keyHandle, toProofContext(context), ring]))
        .mapErr(e => e.value)
        .andThen(response => {
          if (isEnumVariant(response, 'v1')) {
            return ok(response.value);
          }
          // @ts-expect-error response.tag is never here
          return err(new GetAliasErr.Unknown({ reason: `Unsupported response version ${response.tag}` }));
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
    /**
     * Produces an anonymous ring VRF proof with `keyHandle` under `context` in
     * `ring` (RFC-0004, amended by RFC-0024).
     *
     * A proof is a bearer token for its context's alias, so a *foreign*
     * `keyHandle` is admitted only when the owning product allowlisted this one
     * in its manifest — there is no user-prompt fallback, and the host returns
     * `NotAllowlisted` otherwise.
     */
    createRingVRFProof(
      keyHandle: RingVrfKeyHandle,
      context: ProofContext,
      ring: CodecType<typeof RingLocation>,
      message: Uint8Array,
    ) {
      return hostApi
        .accountCreateProof(enumValue('v1', [keyHandle, toProofContext(context), ring, message]))
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
     * Signs `message` with the ring VRF member key itself, producing an ordinary
     * signature rather than an anonymous ring proof (RFC-0024).
     *
     * Takes no context and no ring: it derives no alias and proves no
     * membership. A verifier needs the member public key, so the signature is
     * **linkable** to every other use of that key — including every ring the key
     * is a member of.
     *
     * Like `createRingVRFProof`, a foreign `keyHandle` requires the owner's
     * manifest allowlist and has no prompt fallback.
     */
    ringVrfSign(keyHandle: RingVrfKeyHandle, message: Uint8Array) {
      return hostApi
        .accountRingVrfSign(enumValue('v1', [keyHandle, message]))
        .mapErr(e => e.value)
        .andThen(response => {
          if (isEnumVariant(response, 'v1')) {
            return ok(response.value);
          }
          // @ts-expect-error response.tag is never here
          return err(new RingVrfSignErr.Unknown({ reason: `Unsupported response version ${response.tag}` }));
        });
    },

    /**
     * Produces an sr25519 (schnorrkel) VRF signature from a product account (RFC-0023).
     *
     * The host replays `transcriptLabel` and `items` into a Merlin transcript verbatim —
     * `Transcript::new(transcriptLabel)` then one `append_message(label, value)` per item,
     * in order — and signs it. Callers that need a `signer` item must pass their own public
     * key (from `getProductAccount`); the host never injects it.
     */
    signVrf(
      dotNsIdentifier: string,
      derivationIndex: AccountSelector,
      transcriptLabel: Uint8Array,
      items: VrfTranscriptItem[],
    ) {
      return hostApi
        .accountSignVrf(
          enumValue('v1', { account: [dotNsIdentifier, derivationIndexOf(derivationIndex)], transcriptLabel, items }),
        )
        .mapErr(e => e.value)
        .andThen(response => {
          if (isEnumVariant(response, 'v1')) {
            return ok(response.value);
          }
          // @ts-expect-error response.tag is never here
          return err(new SignVrfErr.Unknown({ reason: `Unsupported response version ${response.tag}` }));
        });
    },

    /**
     * Builds a `TxCreator` (polkadot-api v3) that delegates to the host via
     * `host_create_transaction`. The host keeps ownership of extension inference
     * and signing; the creator maps the v3 `TxPayloadV1` onto the host codec.
     *
     * `publicKey` is exposed synchronously on the returned object and is taken
     * from `account`, so no up-front `host_account_get` is needed.
     */
    getProductAccountSigner(
      account: ProductAccount,
      signerType: 'signPayload' | 'createTransaction' = 'createTransaction',
    ): SignerTxCreator {
      const hostApi = createHostApi(transport);
      const productAccountId: ProductAccountId = [account.dotNsIdentifier, derivationIndexOf(account.derivationIndex)];

      /**
       * @deprecated added for backward compatibility
       */
      if (signerType === 'signPayload') {
        return getTxCreatorFromPjs(
          toHex(account.publicKey),
          async payload => {
            const codecPayload: CodecType<typeof SigningPayload> = {
              account: productAccountId,
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
              account: productAccountId,
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

      // v3 `TxCreator`: a callable that turns a `TxPayloadV1` into a
      // SCALE-encoded extrinsic (hex). A real signature is produced by the host
      // via `host_create_transaction`; a mocked signature (fee estimation) is
      // built locally with a zero-filled signature and no host round-trip,
      // mirroring polkadot-api's own `getTxCreator`.
      const createTx = async (
        payload: TxPayloadV1,
        _opts: unknown,
        _bindings: unknown,
        mockedSignature: boolean,
      ): Promise<string> => {
        // Fee estimation on a v4 extrinsic: build a zero-signed extrinsic
        // locally, with no host round-trip and no real signature. polkadot-api
        // has no local builder for other versions (e.g. v5), so those fall
        // through to the host path below, which returns a well-formed extrinsic
        // of the right size for estimation.
        if (mockedSignature && (payload.txExtVersion ?? 0) === 0) {
          const decMeta = unifyMetadata(decAnyMetadata(payload.context.metadata));
          const v4Extensions = decMeta.extrinsic.extensionsByVersion[0];
          if (v4Extensions) {
            const extra = v4Extensions.map(({ identifier }) => {
              const extension = payload.extensions.find(({ id }) => id === identifier);
              if (!extension) {
                throw new Error(`Missing ${identifier} signed extension`);
              }
              return fromHex(extension.extra);
            });
            const mockSr25519Signature = new Uint8Array(64);
            return toHex(
              createV4Tx(decMeta, account.publicKey, mockSr25519Signature, extra, fromHex(payload.callData), 'Sr25519'),
            );
          }
        }

        const txPayload: CodecType<typeof ProductAccountTransaction> = {
          signer: productAccountId,
          genesisHash: payload.context.genesisHash as HexString,
          callData: fromHex(payload.callData),
          extensions: payload.extensions.map(({ id, extra, additionalSigned }) => ({
            id,
            extra: fromHex(extra),
            additionalSigned: fromHex(additionalSigned),
          })),
          txExtVersion: payload.txExtVersion ?? deriveDefaultTxExtVersion(payload.context.metadata),
        };

        const response = await hostApi.createTransaction(enumValue('v1', txPayload));

        return response.match(
          response => {
            assertEnumVariant(response, 'v1', UNSUPPORTED_VERSION_ERROR);
            return toHex(response.value);
          },
          err => {
            assertEnumVariant(err, 'v1', UNSUPPORTED_VERSION_ERROR);
            throw err.value;
          },
        );
      };

      const signBytes = async (data: Uint8Array): Promise<Uint8Array> => {
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
      };

      return Object.assign(createTx, { publicKey: account.publicKey, signBytes }) as SignerTxCreator;
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
    getLegacyAccountSigner(account: LegacyAccount): SignerTxCreator {
      // The pjs `address` is propagated verbatim into the wire `signer` field
      // (see `signer: payload.address` / `signer: raw.address` below), so it
      // must be an SS58 address the wallet can match — not a raw hex public
      // key. Mirrors the injected-extension path, which uses accountId.dec.
      const accountId = AccountId();
      return getTxCreatorFromPjs(
        accountId.dec(account.publicKey),
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

function toProofContext([productId, suffix]: ProofContext): CodecType<typeof ProductProofContext> {
  return [productId, derivationIndexOf(suffix)];
}

function asHex(v: string): HexString {
  if (v.startsWith('0x')) return v as HexString;
  return `0x${v}`;
}

// Default transaction-extension version to request when the caller leaves it
// unset: 0 for extrinsic v4, the version itself otherwise (e.g. v5).
function deriveDefaultTxExtVersion(metadata: string): number {
  const { version: versions } = unifyMetadata(decAnyMetadata(metadata)).extrinsic;
  const latestVersion = versions.reduce((acc, v) => Math.max(acc, v), 0);
  return latestVersion === 4 ? 0 : latestVersion;
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
