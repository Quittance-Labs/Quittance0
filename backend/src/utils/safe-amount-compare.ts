/**
 * Safe amount comparison re-exported from canonical shared/assets.ts (Issue #447).
 */

export {
  STROOP_DECIMALS,
  STROOPS_PER_UNIT,
  type AmountDeltaStatus,
  type AmountDelta,
  parseStroops,
  formatStroops,
  compareAmounts,
  isUnderpaid,
  isOverpaid,
  describeAmountDelta,
} from '../../../shared/assets';

import {
  STROOP_DECIMALS,
  STROOPS_PER_UNIT,
  parseStroops,
  formatStroops,
  compareAmounts,
  isUnderpaid,
  isOverpaid,
  describeAmountDelta,
} from '../../../shared/assets';

export default {
  STROOP_DECIMALS,
  STROOPS_PER_UNIT,
  parseStroops,
  formatStroops,
  compareAmounts,
  isUnderpaid,
  isOverpaid,
  describeAmountDelta,
};
