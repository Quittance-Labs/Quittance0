/**
 * Backend re-export of the shared invoice lifecycle state machine (issue #443).
 * Storage, handlers, and the payment monitor import from here so they cannot
 * drift from the shared transition table.
 */
export {
  INVOICE_STATUSES,
  LEGAL_INVOICE_TRANSITIONS,
  UI_TERMINAL_INVOICE_STATUSES,
  LIFECYCLE_ERROR_MESSAGES,
  IllegalStateTransitionError,
  assertLegalInvoiceTransition,
  isLegalInvoiceTransition,
  isTerminalInvoiceStatus,
  isUiTerminalInvoiceStatus,
} from '../../../shared/invoice-lifecycle';
export type {
  InvoiceStatus,
  LifecycleErrorCode,
  TransitionValidationOptions,
} from '../../../shared/invoice-lifecycle';
