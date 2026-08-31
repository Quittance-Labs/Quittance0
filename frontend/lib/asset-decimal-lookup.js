// Asset decimal lookup helper.
//
// Returns the number of decimal places the UI should use when displaying or
// validating a given Stellar asset code.

const DEFAULT_DECIMALS = 7;

const ASSET_DECIMALS = Object.freeze({
  XLM: 7,
  USDC: 7,
  USDT: 7,
});

/**
 * Look up the decimal precision for an asset code.
 *
 * @param {string | undefined | null} assetCode - Asset code.
 * @returns {number} Number of decimal places.
 */
function assetDecimalLookup(assetCode) {
  if (!assetCode || typeof assetCode !== 'string') {
    return DEFAULT_DECIMALS;
  }

  const code = assetCode.trim().toUpperCase();
  return ASSET_DECIMALS[code] ?? DEFAULT_DECIMALS;
}

module.exports = { assetDecimalLookup, DEFAULT_DECIMALS, ASSET_DECIMALS };
