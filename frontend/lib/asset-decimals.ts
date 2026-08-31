// Asset decimal lookup helper.
// Returns the number of decimal places the UI should use when displaying or
// validating a given Stellar asset code.

export const DEFAULT_DECIMALS = 7;

const ASSET_DECIMALS: Record<string, number> = Object.freeze({
  XLM: 7,
  USDC: 7,
  USDT: 7,
});

/**
 * Look up the decimal precision for an asset code.
 *
 * @param assetCode - Asset code.
 * @returns Number of decimal places.
 */
export function decimalsForAsset(assetCode: unknown): number {
  if (typeof assetCode !== 'string') {
    return DEFAULT_DECIMALS;
  }

  const code = assetCode.trim().toUpperCase();
  return ASSET_DECIMALS[code] ?? DEFAULT_DECIMALS;
}
