/**
 * Canonical Stellar asset helpers re-exported from shared/assets.ts (Issue #447).
 *
 * See docs/ASSETS.md and docs/USDC-VERIFY-EDGE-CASES.md.
 */

export {
  NATIVE_ASSET_CODE,
  type AssetIdentity,
  type AssetFields,
  resolvePaymentAsset,
  resolveInvoiceAsset,
  assetsMatch,
  formatAssetIdentity,
  requiresIssuer,
} from '../../../shared/assets';

import {
  NATIVE_ASSET_CODE,
  resolvePaymentAsset,
  resolveInvoiceAsset,
  assetsMatch,
  formatAssetIdentity,
  requiresIssuer,
} from '../../../shared/assets';

export default {
  NATIVE_ASSET_CODE,
  resolvePaymentAsset,
  resolveInvoiceAsset,
  assetsMatch,
  formatAssetIdentity,
  requiresIssuer,
};
