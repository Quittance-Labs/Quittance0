/**
 * Domain re-exports for invoice settlement (issue #507).
 *
 * Classification, warning codes, and copy live in shared/settlement.ts so
 * verify, monitor, receipt, timeline, and PDF cannot drift. This module
 * re-exports that contract for backend domain consumers.
 */

export {
  LATE_PAYMENT_WARNING_DEFINITIONS,
  LATE_PAYMENT_WARNINGS,
  SettlementTimeUnavailableError,
  latePaymentWarningForCode,
  parseSettlementTime,
  settlementFieldsForInvoice,
  timelineCopyForLatePayment,
  warningForLatePayment,
  type LatePaymentWarningCode,
  type LatePaymentWarningDefinition,
  type SettlementContext,
  type SettlementFields,
  type SettlementInvoiceState,
} from '../../../shared/settlement';
