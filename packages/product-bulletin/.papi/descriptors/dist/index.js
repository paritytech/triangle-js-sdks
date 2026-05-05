import { _Enum } from 'polkadot-api';

const table = new Uint8Array(128);
for (let i = 0; i < 64; i++) table[i < 26 ? i + 65 : i < 52 ? i + 71 : i < 62 ? i - 4 : i * 4 - 205] = i;
const toBinary = (base64) => {
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

const descriptorValues$3 = import('./descriptors-Dge-jRzR.js').then((module) => module["Bulletin_westend"]);
const metadataTypes$3 = import('./metadataTypes-DWFwcrnp.js').then(
  (module) => toBinary("default" in module ? module.default : module)
);
const asset$3 = {};
const extensions$3 = {};
const getMetadata$4 = () => import('./bulletin_westend_metadata-CzkMM1cj.js').then(
  (module) => toBinary("default" in module ? module.default : module)
);
const genesis$3 = "0xee1f44f62e68312c4852f37585941e9b64b5ceae539e4aa112ce9d3cf7bbe9fd";
const _allDescriptors$3 = { descriptors: descriptorValues$3, metadataTypes: metadataTypes$3, asset: asset$3, extensions: extensions$3, getMetadata: getMetadata$4, genesis: genesis$3 };

const descriptorValues$2 = import('./descriptors-Dge-jRzR.js').then((module) => module["Bulletin_paseo"]);
const metadataTypes$2 = import('./metadataTypes-DWFwcrnp.js').then(
  (module) => toBinary("default" in module ? module.default : module)
);
const asset$2 = {};
const extensions$2 = {};
const getMetadata$3 = () => import('./bulletin_paseo_metadata-Btf7Dcxv.js').then(
  (module) => toBinary("default" in module ? module.default : module)
);
const genesis$2 = "0x744960c32e3a3df5440e1ecd4d34096f1ce2230d7016a5ada8a765d5a622b4ea";
const _allDescriptors$2 = { descriptors: descriptorValues$2, metadataTypes: metadataTypes$2, asset: asset$2, extensions: extensions$2, getMetadata: getMetadata$3, genesis: genesis$2 };

const descriptorValues$1 = import('./descriptors-Dge-jRzR.js').then((module) => module["Bulletin_pop_stable"]);
const metadataTypes$1 = import('./metadataTypes-DWFwcrnp.js').then(
  (module) => toBinary("default" in module ? module.default : module)
);
const asset$1 = {};
const extensions$1 = {};
const getMetadata$2 = () => import('./bulletin_pop_stable_metadata-DqBeJqWj.js').then(
  (module) => toBinary("default" in module ? module.default : module)
);
const genesis$1 = "0x6fdf4baff0328ddaca1812e6d2f8f26afc439e6e0a339c0094d17013f8da246d";
const _allDescriptors$1 = { descriptors: descriptorValues$1, metadataTypes: metadataTypes$1, asset: asset$1, extensions: extensions$1, getMetadata: getMetadata$2, genesis: genesis$1 };

const descriptorValues = import('./descriptors-Dge-jRzR.js').then((module) => module["Bulletin_previewnet"]);
const metadataTypes = import('./metadataTypes-DWFwcrnp.js').then(
  (module) => toBinary("default" in module ? module.default : module)
);
const asset = {};
const extensions = {};
const getMetadata$1 = () => import('./bulletin_previewnet_metadata-DR1_ORGs.js').then(
  (module) => toBinary("default" in module ? module.default : module)
);
const genesis = "0x1c28cc48ee21f4f6dd2712c68c9a416f19cd518cbfe205e70e4d9dd007278fca";
const _allDescriptors = { descriptors: descriptorValues, metadataTypes, asset, extensions, getMetadata: getMetadata$1, genesis };

const DigestItem = _Enum;
const Phase = _Enum;
const DispatchClass = _Enum;
const TokenError = _Enum;
const ArithmeticError = _Enum;
const TransactionalError = _Enum;
const BalanceStatus = _Enum;
const TransactionPaymentEvent = _Enum;
const XcmV5Junctions = _Enum;
const XcmV5Junction = _Enum;
const XcmV5NetworkId = _Enum;
const XcmV3JunctionBodyId = _Enum;
const XcmV2JunctionBodyPart = _Enum;
const XcmV5Instruction = _Enum;
const XcmV3MultiassetFungibility = _Enum;
const XcmV3MultiassetAssetInstance = _Enum;
const XcmV3MaybeErrorCode = _Enum;
const XcmV2OriginKind = _Enum;
const XcmV5AssetFilter = _Enum;
const XcmV5WildAsset = _Enum;
const XcmV2MultiassetWildFungibility = _Enum;
const XcmV3WeightLimit = _Enum;
const XcmVersionedAssets = _Enum;
const XcmV3MultiassetAssetId = _Enum;
const XcmV3Junctions = _Enum;
const XcmV3Junction = _Enum;
const XcmV3JunctionNetworkId = _Enum;
const XcmVersionedLocation = _Enum;
const UpgradeGoAhead = _Enum;
const UpgradeRestriction = _Enum;
const BalancesTypesReasons = _Enum;
const TransactionPaymentReleases = _Enum;
const XcmV3Response = _Enum;
const XcmV3TraitsError = _Enum;
const XcmV4Response = _Enum;
const XcmPalletVersionMigrationStage = _Enum;
const XcmVersionedAssetId = _Enum;
const MultiAddress = _Enum;
const BalancesAdjustmentDirection = _Enum;
const XcmVersionedXcm = _Enum;
const XcmV3Instruction = _Enum;
const XcmV3MultiassetMultiAssetFilter = _Enum;
const XcmV3MultiassetWildMultiAsset = _Enum;
const XcmV4Instruction = _Enum;
const XcmV4AssetAssetFilter = _Enum;
const XcmV4AssetWildAsset = _Enum;
const TransactionValidityUnknownTransaction = _Enum;
const TransactionValidityTransactionSource = _Enum;
const XcmVersionedAsset = _Enum;

const metadatas = {
  ["0x9838682961f13a0665e7dac54178aa99531391530e60e879a9eab84d6dc2a199"]: _allDescriptors$3,
  ["0x1a82e5143be3211ded412b0368b486ce83bd41a80ec95eb267f6c204adda8365"]: _allDescriptors$2,
  ["0xce76768a4d9db3a9dbea8acdefeec037a1119dafdc98c62c30c90453ef3a2c75"]: _allDescriptors$1,
  ["0xbf09b8cae0c5d583cfb06367e0398dca67a840937387a3841731092aa4b9dc0b"]: _allDescriptors
};
const getMetadata = async (codeHash) => {
  try {
    return await metadatas[codeHash].getMetadata();
  } catch {
  }
  return null;
};

export { ArithmeticError, BalanceStatus, BalancesAdjustmentDirection, BalancesTypesReasons, DigestItem, DispatchClass, MultiAddress, Phase, TokenError, TransactionPaymentEvent, TransactionPaymentReleases, TransactionValidityTransactionSource, TransactionValidityUnknownTransaction, TransactionalError, UpgradeGoAhead, UpgradeRestriction, XcmPalletVersionMigrationStage, XcmV2JunctionBodyPart, XcmV2MultiassetWildFungibility, XcmV2OriginKind, XcmV3Instruction, XcmV3Junction, XcmV3JunctionBodyId, XcmV3JunctionNetworkId, XcmV3Junctions, XcmV3MaybeErrorCode, XcmV3MultiassetAssetId, XcmV3MultiassetAssetInstance, XcmV3MultiassetFungibility, XcmV3MultiassetMultiAssetFilter, XcmV3MultiassetWildMultiAsset, XcmV3Response, XcmV3TraitsError, XcmV3WeightLimit, XcmV4AssetAssetFilter, XcmV4AssetWildAsset, XcmV4Instruction, XcmV4Response, XcmV5AssetFilter, XcmV5Instruction, XcmV5Junction, XcmV5Junctions, XcmV5NetworkId, XcmV5WildAsset, XcmVersionedAsset, XcmVersionedAssetId, XcmVersionedAssets, XcmVersionedLocation, XcmVersionedXcm, _allDescriptors$2 as bulletin_paseo, _allDescriptors$1 as bulletin_pop_stable, _allDescriptors as bulletin_previewnet, _allDescriptors$3 as bulletin_westend, getMetadata };
