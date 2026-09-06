const ASSET_DECIMALS: Record<string, number> = {
  XLM: 7,
  USDC: 7,
  USDT: 7,
  EURC: 7,
};

const DEFAULT_STELLAR_DECIMALS = 7;

/**
 * Returns the decimal precision for a Stellar asset code.
 * Defaults to 7 decimals for unknown or unspecified assets.
 *
 * @param code - Asset code string (e.g. 'XLM', 'USDC')
 * @returns Decimal precision number
 */
export function decimalsForAsset(code?: string | null): number {
  if (!code || typeof code !== 'string') {
    return DEFAULT_STELLAR_DECIMALS;
  }

  const normalized = code.trim().toUpperCase();
  return ASSET_DECIMALS[normalized] ?? DEFAULT_STELLAR_DECIMALS;
}
