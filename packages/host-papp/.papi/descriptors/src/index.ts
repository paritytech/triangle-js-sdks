import { default as people_lite, type People_liteWhitelistEntry } from "./people_lite.js";
export { people_lite }
export type * from "./people_lite.js";
export {
DigestItem, Phase, DispatchClass, TokenError, ArithmeticError, TransactionalError, BalanceStatus, TransactionPaymentEvent, XcmV5Junctions, XcmV5Junction, XcmV5NetworkId, XcmV3JunctionBodyId, XcmV2JunctionBodyPart, XcmV5Instruction, XcmV3MultiassetFungibility, XcmV3MultiassetAssetInstance, XcmV3MaybeErrorCode, XcmV2OriginKind, XcmV5AssetFilter, XcmV5WildAsset, XcmV2MultiassetWildFungibility, XcmV3WeightLimit, XcmVersionedAssets, XcmV3MultiassetAssetId, XcmV3Junctions, XcmV3Junction, XcmV3JunctionNetworkId, XcmVersionedLocation, UpgradeGoAhead, UpgradeRestriction, BalancesTypesReasons, TransactionPaymentReleases, XcmV3Response, XcmV3TraitsError, XcmV4Response, XcmPalletVersionMigrationStage, XcmVersionedAssetId, IdentityData, MultiAddress, BalancesAdjustmentDirection, XcmVersionedXcm, XcmV3Instruction, XcmV3MultiassetMultiAssetFilter, XcmV3MultiassetWildMultiAsset, XcmV4Instruction, XcmV4AssetAssetFilter, XcmV4AssetWildAsset, TransactionValidityUnknownTransaction, TransactionValidityTransactionSource
} from './common-types.js';
const metadatas: Record<string, { getMetadata: () => Promise<Uint8Array> }> = {["0xee12eb3f12f8387448d2bf78c773dda08731483357a1b8fb773374f7b7bc417c"]: people_lite}

export const getMetadata: (codeHash: string) => Promise<Uint8Array | null> = async (
  codeHash: string
)=> {
  try {
    return await metadatas[codeHash].getMetadata()
  } catch {}
  return null
}
export type WhitelistEntry = People_liteWhitelistEntry;
export type WhitelistEntriesByChain = Partial<{"*": WhitelistEntry[], people_lite: WhitelistEntry[]}>
