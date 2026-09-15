// Asset code normalizer for display.
// Ensures asset codes are presented consistently across the UI: uppercase,
// trimmed, and with a safe fallback for native / missing assets.
// Delegates to canonical shared/assets.ts (Issue #447).

import {
  normalizeAssetCode as canonicalNormalizeAssetCode,
  NATIVE_ASSET_CODE,
} from '../../shared/assets.ts';

export { NATIVE_ASSET_CODE };

/**
 * Normalise an asset code for display.
 *
 * @param code - Raw asset code.
 * @returns Canonical display asset code.
 */
export function normalizeAssetCode(code: unknown): string {
  return canonicalNormalizeAssetCode(code);
}

export default { NATIVE_ASSET_CODE, normalizeAssetCode };
