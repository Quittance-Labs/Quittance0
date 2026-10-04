import {
  decimalsForAsset as canonicalDecimalsForAsset,
  STROOP_DECIMALS,
} from '../../shared/assets.ts';

export const DEFAULT_DECIMALS = STROOP_DECIMALS;

/**
 * Look up the decimal precision for an asset code.
 *
 * @param assetCode - Asset code.
 * @returns Number of decimal places.
 */
export function decimalsForAsset(assetCode: unknown): number {
  return canonicalDecimalsForAsset(assetCode);
}

export default { DEFAULT_DECIMALS, decimalsForAsset };
