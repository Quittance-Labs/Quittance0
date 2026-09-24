import {
  normalizeAssetCode as canonicalNormalizeAssetCode,
  formatAssetLabel,
  NATIVE_ASSET_CODE,
} from '../../shared/assets.ts';

export { NATIVE_ASSET_CODE, formatAssetLabel };

/**
 * Normalise an asset code for display.
 *
 * @param code - Raw asset code.
 * @returns Canonical display asset code.
 */
export function normalizeAssetCode(code: unknown): string {
  return canonicalNormalizeAssetCode(code);
}

export default { NATIVE_ASSET_CODE, normalizeAssetCode, formatAssetLabel };
