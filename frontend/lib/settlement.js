/**
 * Client side of the canonical settlement contract (issue #507).
 *
 * Classification and warning copy live in shared/settlement.ts, which the
 * backend uses too. Surfaces that show late-payment warnings (timeline,
 * receipt, PDF export) must read copy from here so they cannot drift from
 * the API warning code.
 */

const {
  LATE_PAYMENT_WARNING_DEFINITIONS,
  LATE_PAYMENT_WARNINGS,
  latePaymentWarningForCode,
  timelineCopyForLatePayment,
  warningForLatePayment,
  parseSettlementTime,
  settlementFieldsForInvoice,
  SettlementTimeUnavailableError,
} = require('../../shared/settlement.ts');

module.exports = {
  LATE_PAYMENT_WARNING_DEFINITIONS,
  LATE_PAYMENT_WARNINGS,
  latePaymentWarningForCode,
  timelineCopyForLatePayment,
  warningForLatePayment,
  parseSettlementTime,
  settlementFieldsForInvoice,
  SettlementTimeUnavailableError,
};
