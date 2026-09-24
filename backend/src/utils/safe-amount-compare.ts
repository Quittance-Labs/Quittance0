/**
 * Safe amount comparison — re-exported from shared/assets.ts (issue #447).
 * String-safe stroop parse/format/compare with no floating-point arithmetic.
 */

export {
  STROOP_DECIMALS,
  STROOPS_PER_UNIT,
  parseStroops,
  formatStroops,
  canonicalAmount,
  amountsEqual,
  compareAmounts,
  isUnderpaid,
  isOverpaid,
  describeAmountDelta,
  type AmountDelta,
  type AmountDeltaStatus,
} from '../../../shared/assets';
