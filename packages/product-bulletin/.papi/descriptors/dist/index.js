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

const descriptorValues$3 = import('./descriptors-Br5i5shy.js').then((module) => module["Bulletin_westend"]);
const metadataTypes$3 = import('./metadataTypes-BpbRJS7y.js').then(
  (module) => toBinary("default" in module ? module.default : module)
);
const extensions$3 = {};
const requiredExtensions$3 = {};
const getMetadata$4 = () => import('./bulletin_westend_metadata-DEhG-bdi.js').then(
  (module) => toBinary("default" in module ? module.default : module)
);
const genesis$3 = "0xee1f44f62e68312c4852f37585941e9b64b5ceae539e4aa112ce9d3cf7bbe9fd";
const _allDescriptors$3 = { descriptors: descriptorValues$3, metadataTypes: metadataTypes$3, extensions: extensions$3, requiredExtensions: requiredExtensions$3, getMetadata: getMetadata$4, genesis: genesis$3 };

const descriptorValues$2 = import('./descriptors-Br5i5shy.js').then((module) => module["Bulletin_paseo"]);
const metadataTypes$2 = import('./metadataTypes-BpbRJS7y.js').then(
  (module) => toBinary("default" in module ? module.default : module)
);
const extensions$2 = {};
const requiredExtensions$2 = {};
const getMetadata$3 = () => import('./bulletin_paseo_metadata-CqqzAxrq.js').then(
  (module) => toBinary("default" in module ? module.default : module)
);
const genesis$2 = "0xe101f0fa4627d29a257645e02be86d80378fea1a2bf8fa6a918d150ebc760a59";
const _allDescriptors$2 = { descriptors: descriptorValues$2, metadataTypes: metadataTypes$2, extensions: extensions$2, requiredExtensions: requiredExtensions$2, getMetadata: getMetadata$3, genesis: genesis$2 };

const descriptorValues$1 = import('./descriptors-Br5i5shy.js').then((module) => module["Bulletin_pop_stable"]);
const metadataTypes$1 = import('./metadataTypes-BpbRJS7y.js').then(
  (module) => toBinary("default" in module ? module.default : module)
);
const extensions$1 = {};
const requiredExtensions$1 = {};
const getMetadata$2 = () => import('./bulletin_pop_stable_metadata-B5YIN1Ow.js').then(
  (module) => toBinary("default" in module ? module.default : module)
);
const genesis$1 = "0x8cfe6717dc4becfda2e13c488a1e2061ff2dfee96e7d031157f72d36716c0a22";
const _allDescriptors$1 = { descriptors: descriptorValues$1, metadataTypes: metadataTypes$1, extensions: extensions$1, requiredExtensions: requiredExtensions$1, getMetadata: getMetadata$2, genesis: genesis$1 };

const descriptorValues = import('./descriptors-Br5i5shy.js').then((module) => module["Bulletin_previewnet"]);
const metadataTypes = import('./metadataTypes-BpbRJS7y.js').then(
  (module) => toBinary("default" in module ? module.default : module)
);
const extensions = {};
const requiredExtensions = {};
const getMetadata$1 = () => import('./bulletin_previewnet_metadata-B5YIN1Ow.js').then(
  (module) => toBinary("default" in module ? module.default : module)
);
const genesis = "0x2778b1c94c4362e49a54be57d3056bc714f3712e4486625312704ffb74eb973d";
const _allDescriptors = { descriptors: descriptorValues, metadataTypes, extensions, requiredExtensions, getMetadata: getMetadata$1, genesis };

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
const ExtensionsCheckMortality = _Enum;

const metadatas = {
  ["0x38bfc044dabd6d3ad3494e4096d8efbf8f6d7e66f69dd6a4526f5ceaf4e72356"]: _allDescriptors$3,
  ["0x919b08470811f08edef7c2d15d387182adf5b501c2a2c8486c5b829a2c78018b"]: _allDescriptors$2,
  ["0xe6deb62a7078a64b2534febedb4638acce1615a95b2622272d368db3e559b8ac"]: _allDescriptors
};
const getMetadata = async (codeHash) => {
  try {
    return await metadatas[codeHash].getMetadata();
  } catch {
  }
  return null;
};

export { ArithmeticError, BalanceStatus, BalancesAdjustmentDirection, BalancesTypesReasons, DigestItem, DispatchClass, ExtensionsCheckMortality, MultiAddress, Phase, TokenError, TransactionPaymentEvent, TransactionPaymentReleases, TransactionValidityTransactionSource, TransactionValidityUnknownTransaction, TransactionalError, UpgradeGoAhead, UpgradeRestriction, XcmPalletVersionMigrationStage, XcmV2JunctionBodyPart, XcmV2MultiassetWildFungibility, XcmV2OriginKind, XcmV3Instruction, XcmV3Junction, XcmV3JunctionBodyId, XcmV3JunctionNetworkId, XcmV3Junctions, XcmV3MaybeErrorCode, XcmV3MultiassetAssetId, XcmV3MultiassetAssetInstance, XcmV3MultiassetFungibility, XcmV3MultiassetMultiAssetFilter, XcmV3MultiassetWildMultiAsset, XcmV3Response, XcmV3TraitsError, XcmV3WeightLimit, XcmV4AssetAssetFilter, XcmV4AssetWildAsset, XcmV4Instruction, XcmV4Response, XcmV5AssetFilter, XcmV5Instruction, XcmV5Junction, XcmV5Junctions, XcmV5NetworkId, XcmV5WildAsset, XcmVersionedAsset, XcmVersionedAssetId, XcmVersionedAssets, XcmVersionedLocation, XcmVersionedXcm, _allDescriptors$2 as bulletin_paseo, _allDescriptors$1 as bulletin_pop_stable, _allDescriptors as bulletin_previewnet, _allDescriptors$3 as bulletin_westend, getMetadata };
