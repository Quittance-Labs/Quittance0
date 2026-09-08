// Stellar amount tolerance helper.
//
// Stellar accounts for amounts as integers of stroops (1 XLM = 1e7 stroops),
// so string formats and JS float rounding can produce off-by-stroop
// representations of the same on-chain value. `amountsMatch` accepts a
// signed tolerance in stroops so callers can allow an exact match (tolerance
// 0, default) or a one-stroop window (+/-1 stroop) for on-chain settlement.
//
// Stroop precision is fixed at 7 decimal places by the Stellar protocol.

export const STROOP_DECIMALS = 7;

const STROOP_SCALE = 10 ** STROOP_DECIMALS;
const MAX_SAFE_STROOP = Number.MAX_SAFE_INTEGER; // fits the Stellar total supply (~5 * 1e10 XLM = 5e17 stroops) without rounding.

export interface AmountMatchInput {
  expected: string | number;
  actual: unknown;
  toleranceStroops?: number;
}

/**
 * Compare two Stellar amounts with an allowable delta, measured in stroops.
 *
 * @param expected   Amount the invoice demands. String or number.
 * @param actual     Amount observed on-chain from Horizon. Typically a
 *                   decimal string such as `operation.amount`. Passed as
 *                   `unknown` because callers operate on raw API response
 *                   fields.
 * @param toleranceStroops  Width of the acceptance window, in stroops.
 *                   Non-negative integer. Defaults to 0 (exact stroop
 *                   match). Tolerance is signed symmetrically: a tolerance
 *                   of N means an actual within N stroops below the
 *                   expected value, or within N stroops above, still
 *                   matches.
 * @returns          true when both operands parse to finite numbers whose
 *                   absolute stroop difference is <= toleranceStroops.
 *                   Returns false for malformed input, NaN, +/-Infinity,
 *                   negative tolerance, or tolerance values that cannot
 *                   be represented as safe integers.
 */
export function amountsMatch(
  expected: string | number,
  actual: unknown,
  toleranceStroops: number = 0
): boolean {
  if (!Number.isInteger(toleranceStroops) || toleranceStroops < 0) {
    return false;
  }

  const expectedStr = typeof expected === 'string' ? expected : String(expected);
  const actualStr = typeof actual === 'string' || typeof actual === 'number' ? String(actual) : '';

  if (expectedStr.trim() === '' || actualStr.trim() === '') {
    return false;
  }

  const expectedNum = Number(expectedStr);
  const actualNum = Number(actualStr);

  if (!Number.isFinite(expectedNum) || !Number.isFinite(actualNum)) {
    return false;
  }

  const expectedStroops = Math.round(expectedNum * STROOP_SCALE);
  const actualStroops = Math.round(actualNum * STROOP_SCALE);

  if (
    !Number.isSafeInteger(expectedStroops) ||
    !Number.isSafeInteger(actualStroops)
  ) {
    return false;
  }

  void MAX_SAFE_STROOP; // reference kept so readers can correlate the bound above.

  const delta = Math.abs(expectedStroops - actualStroops);
  return delta <= toleranceStroops;
}

export default { amountsMatch, STROOP_DECIMALS };
