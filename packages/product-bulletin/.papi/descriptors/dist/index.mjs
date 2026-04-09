// .papi/descriptors/src/bulletin_westend.ts
import "polkadot-api";

// .papi/descriptors/src/common-types.ts
import { _Enum } from "polkadot-api";
var DigestItem = _Enum;
var Phase = _Enum;
var DispatchClass = _Enum;
var TokenError = _Enum;
var ArithmeticError = _Enum;
var TransactionalError = _Enum;
var BalanceStatus = _Enum;
var TransactionPaymentEvent = _Enum;
var XcmV5Junctions = _Enum;
var XcmV5Junction = _Enum;
var XcmV5NetworkId = _Enum;
var XcmV3JunctionBodyId = _Enum;
var XcmV2JunctionBodyPart = _Enum;
var XcmV5Instruction = _Enum;
var XcmV3MultiassetFungibility = _Enum;
var XcmV3MultiassetAssetInstance = _Enum;
var XcmV3MaybeErrorCode = _Enum;
var XcmV2OriginKind = _Enum;
var XcmV5AssetFilter = _Enum;
var XcmV5WildAsset = _Enum;
var XcmV2MultiassetWildFungibility = _Enum;
var XcmV3WeightLimit = _Enum;
var XcmVersionedAssets = _Enum;
var XcmV3MultiassetAssetId = _Enum;
var XcmV3Junctions = _Enum;
var XcmV3Junction = _Enum;
var XcmV3JunctionNetworkId = _Enum;
var XcmVersionedLocation = _Enum;
var UpgradeGoAhead = _Enum;
var UpgradeRestriction = _Enum;
var BalancesTypesReasons = _Enum;
var TransactionPaymentReleases = _Enum;
var XcmV3Response = _Enum;
var XcmV3TraitsError = _Enum;
var XcmV4Response = _Enum;
var XcmPalletVersionMigrationStage = _Enum;
var XcmVersionedAssetId = _Enum;
var MultiAddress = _Enum;
var BalancesAdjustmentDirection = _Enum;
var XcmVersionedXcm = _Enum;
var XcmV3Instruction = _Enum;
var XcmV3MultiassetMultiAssetFilter = _Enum;
var XcmV3MultiassetWildMultiAsset = _Enum;
var XcmV4Instruction = _Enum;
var XcmV4AssetAssetFilter = _Enum;
var XcmV4AssetWildAsset = _Enum;
var TransactionValidityUnknownTransaction = _Enum;
var TransactionValidityTransactionSource = _Enum;
var XcmVersionedAsset = _Enum;

// .papi/descriptors/src/common.ts
var table = new Uint8Array(128);
for (let i = 0; i < 64; i++) table[i < 26 ? i + 65 : i < 52 ? i + 71 : i < 62 ? i - 4 : i * 4 - 205] = i;
var toBinary = (base64) => {
  const n = base64.length, bytes = new Uint8Array((n - Number(base64[n - 1] === "=") - Number(base64[n - 2] === "=")) * 3 / 4 | 0);
  for (let i2 = 0, j = 0; i2 < n; ) {
    const c0 = table[base64.charCodeAt(i2++)], c1 = table[base64.charCodeAt(i2++)];
    const c2 = table[base64.charCodeAt(i2++)], c3 = table[base64.charCodeAt(i2++)];
    bytes[j++] = c0 << 2 | c1 >> 4;
    bytes[j++] = c1 << 4 | c2 >> 2;
    bytes[j++] = c2 << 6 | c3;
  }
  return bytes;
};

// .papi/descriptors/src/bulletin_westend.ts
var descriptorValues = import("./descriptors-YUG6AIQM.mjs").then((module) => module["Bulletin_westend"]);
var metadataTypes = import("./metadataTypes-DTNWE4SB.mjs").then(
  (module) => toBinary("default" in module ? module.default : module)
);
var asset = {};
var extensions = {};
var getMetadata = () => import("./bulletin_westend_metadata-MOBZ42D3.mjs").then(
  (module) => toBinary("default" in module ? module.default : module)
);
var genesis = "0xee1f44f62e68312c4852f37585941e9b64b5ceae539e4aa112ce9d3cf7bbe9fd";
var _allDescriptors = { descriptors: descriptorValues, metadataTypes, asset, extensions, getMetadata, genesis };
var bulletin_westend_default = _allDescriptors;

// .papi/descriptors/src/bulletin_paseo.ts
import "polkadot-api";
var descriptorValues2 = import("./descriptors-YUG6AIQM.mjs").then((module) => module["Bulletin_paseo"]);
var metadataTypes2 = import("./metadataTypes-DTNWE4SB.mjs").then(
  (module) => toBinary("default" in module ? module.default : module)
);
var asset2 = {};
var extensions2 = {};
var getMetadata2 = () => import("./bulletin_paseo_metadata-XJEJDO5L.mjs").then(
  (module) => toBinary("default" in module ? module.default : module)
);
var genesis2 = "0x744960c32e3a3df5440e1ecd4d34096f1ce2230d7016a5ada8a765d5a622b4ea";
var _allDescriptors2 = { descriptors: descriptorValues2, metadataTypes: metadataTypes2, asset: asset2, extensions: extensions2, getMetadata: getMetadata2, genesis: genesis2 };
var bulletin_paseo_default = _allDescriptors2;

// .papi/descriptors/src/bulletin_pop_stable.ts
import "polkadot-api";
var descriptorValues3 = import("./descriptors-YUG6AIQM.mjs").then((module) => module["Bulletin_pop_stable"]);
var metadataTypes3 = import("./metadataTypes-DTNWE4SB.mjs").then(
  (module) => toBinary("default" in module ? module.default : module)
);
var asset3 = {};
var extensions3 = {};
var getMetadata3 = () => import("./bulletin_pop_stable_metadata-N6TQUQNX.mjs").then(
  (module) => toBinary("default" in module ? module.default : module)
);
var genesis3 = "0x6fdf4baff0328ddaca1812e6d2f8f26afc439e6e0a339c0094d17013f8da246d";
var _allDescriptors3 = { descriptors: descriptorValues3, metadataTypes: metadataTypes3, asset: asset3, extensions: extensions3, getMetadata: getMetadata3, genesis: genesis3 };
var bulletin_pop_stable_default = _allDescriptors3;

// .papi/descriptors/src/bulletin_previewnet.ts
import "polkadot-api";
var descriptorValues4 = import("./descriptors-YUG6AIQM.mjs").then((module) => module["Bulletin_previewnet"]);
var metadataTypes4 = import("./metadataTypes-DTNWE4SB.mjs").then(
  (module) => toBinary("default" in module ? module.default : module)
);
var asset4 = {};
var extensions4 = {};
var getMetadata4 = () => import("./bulletin_previewnet_metadata-RUVAQRWO.mjs").then(
  (module) => toBinary("default" in module ? module.default : module)
);
var genesis4 = "0x1c28cc48ee21f4f6dd2712c68c9a416f19cd518cbfe205e70e4d9dd007278fca";
var _allDescriptors4 = { descriptors: descriptorValues4, metadataTypes: metadataTypes4, asset: asset4, extensions: extensions4, getMetadata: getMetadata4, genesis: genesis4 };
var bulletin_previewnet_default = _allDescriptors4;

// .papi/descriptors/src/index.ts
var metadatas = {
  ["0x9838682961f13a0665e7dac54178aa99531391530e60e879a9eab84d6dc2a199"]: bulletin_westend_default,
  ["0x1a82e5143be3211ded412b0368b486ce83bd41a80ec95eb267f6c204adda8365"]: bulletin_paseo_default,
  ["0xce76768a4d9db3a9dbea8acdefeec037a1119dafdc98c62c30c90453ef3a2c75"]: bulletin_pop_stable_default,
  ["0xbf09b8cae0c5d583cfb06367e0398dca67a840937387a3841731092aa4b9dc0b"]: bulletin_previewnet_default
};
var getMetadata5 = async (codeHash) => {
  try {
    return await metadatas[codeHash].getMetadata();
  } catch {
  }
  return null;
};
export {
  ArithmeticError,
  BalanceStatus,
  BalancesAdjustmentDirection,
  BalancesTypesReasons,
  DigestItem,
  DispatchClass,
  MultiAddress,
  Phase,
  TokenError,
  TransactionPaymentEvent,
  TransactionPaymentReleases,
  TransactionValidityTransactionSource,
  TransactionValidityUnknownTransaction,
  TransactionalError,
  UpgradeGoAhead,
  UpgradeRestriction,
  XcmPalletVersionMigrationStage,
  XcmV2JunctionBodyPart,
  XcmV2MultiassetWildFungibility,
  XcmV2OriginKind,
  XcmV3Instruction,
  XcmV3Junction,
  XcmV3JunctionBodyId,
  XcmV3JunctionNetworkId,
  XcmV3Junctions,
  XcmV3MaybeErrorCode,
  XcmV3MultiassetAssetId,
  XcmV3MultiassetAssetInstance,
  XcmV3MultiassetFungibility,
  XcmV3MultiassetMultiAssetFilter,
  XcmV3MultiassetWildMultiAsset,
  XcmV3Response,
  XcmV3TraitsError,
  XcmV3WeightLimit,
  XcmV4AssetAssetFilter,
  XcmV4AssetWildAsset,
  XcmV4Instruction,
  XcmV4Response,
  XcmV5AssetFilter,
  XcmV5Instruction,
  XcmV5Junction,
  XcmV5Junctions,
  XcmV5NetworkId,
  XcmV5WildAsset,
  XcmVersionedAsset,
  XcmVersionedAssetId,
  XcmVersionedAssets,
  XcmVersionedLocation,
  XcmVersionedXcm,
  bulletin_paseo_default as bulletin_paseo,
  bulletin_pop_stable_default as bulletin_pop_stable,
  bulletin_previewnet_default as bulletin_previewnet,
  bulletin_westend_default as bulletin_westend,
  getMetadata5 as getMetadata
};
