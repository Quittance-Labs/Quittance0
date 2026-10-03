/**
 * Canonical Stellar asset resolution — re-exported from shared/assets.ts
 * (issue #447). See docs/ASSETS.md.
 */

export {
  NATIVE_ASSET_CODE,
  requiresIssuer,
  resolvePaymentAsset,
  resolveInvoiceAsset,
  assetsMatch,
  formatAssetIdentity,
  formatAssetLabel,
  getAssetIssuer,
  isKnownAssetIssuer,
  validateAssetAndAmount,
  type AssetIdentity,
  type AssetFields,
} from '../../../shared/assets';

import {
  NATIVE_ASSET_CODE,
  requiresIssuer,
  resolvePaymentAsset,
  resolveInvoiceAsset,
  assetsMatch,
  formatAssetIdentity,
} from '../../../shared/assets';

export default {
  NATIVE_ASSET_CODE,
  resolvePaymentAsset,
  resolveInvoiceAsset,
  assetsMatch,
  formatAssetIdentity,
  requiresIssuer,
};
