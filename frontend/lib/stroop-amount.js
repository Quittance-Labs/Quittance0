/**
 * Stroop-accurate amount helpers — re-export of shared/assets.ts (issue #447).
 * Horizon amounts are strings and Stellar precision is fixed at 7 decimals, so
 * every amount the UI accepts, compares, prints, or embeds goes through BigInt
 * stroops in the shared subsystem.
 */

export {
  STROOP_DECIMALS,
  STROOPS_PER_UNIT,
  parseStroops,
  formatStroops,
  canonicalAmount,
  amountsEqual,
} from '../../shared/assets.ts';
