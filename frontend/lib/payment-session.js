/**
 * Shared payment session model for the pay page (issue #445).
 *
 * The existing `payment-page-state` reducer remains the source of transitions
 * (Freighter pay, verify, poll, wallet-switch reset). This module maps that
 * flow — plus loading and load failures — onto one UI session model:
 * loading, ready, paying, verifying, paid, rejected, unavailable.
 *
 * Product rules are unchanged: Freighter identity, optional email, rejection
 * classifiers, and Horizon outage handling stay in their existing modules and
 * are wired through the same session events the reducer already understands.
 */

const { effectiveInvoiceStatus } = require('./invoice-lifecycle');
const { isTerminalPayState } = require('./pay-terminal-guard.ts');
const { shouldPoll } = require('./payment-page-state');

/** Canonical session state identifiers. */
const SESSION_STATES = Object.freeze({
  LOADING: 'loading',
  READY: 'ready',
  PAYING: 'paying',
  VERIFYING: 'verifying',
  PAID: 'paid',
  REJECTED: 'rejected',
  UNAVAILABLE: 'unavailable',
});

/** Terminal session statuses that non-ledger events must not override. */
const TERMINAL_SESSION_STATUSES = Object.freeze([
  SESSION_STATES.PAID,
  SESSION_STATES.UNAVAILABLE,
]);

/**
 * Whether a session status is terminal.
 * `paid` and `unavailable` (expired / cancelled / load failure) stay put.
 */
function isTerminalSessionStatus(status) {
  if (!status || typeof status !== 'string') return false;
  const normalized = status.trim().toLowerCase();
  return (
    normalized === SESSION_STATES.PAID ||
    normalized === SESSION_STATES.UNAVAILABLE ||
    isTerminalPayState(normalized)
  );
}

/**
 * Derive the active payment session status from invoice lifecycle + pay flow.
 *
 * Maps the legacy payment reducer statuses (`idle` → ready, `error` → rejected,
 * `expired` → unavailable) so the UI has one vocabulary without forking the
 * reducer that already owns Freighter / verify / poll transitions.
 */
function deriveSessionStatus({ loading, invoice, paymentStatus, loadError }) {
  if (loading && !invoice) {
    return SESSION_STATES.LOADING;
  }
  if (!invoice && loadError) {
    return SESSION_STATES.UNAVAILABLE;
  }

  const normalized = typeof paymentStatus === 'string' ? paymentStatus.trim().toLowerCase() : '';

  if (normalized === 'paying') return SESSION_STATES.PAYING;
  if (normalized === 'verifying') return SESSION_STATES.VERIFYING;

  const effectiveStatus = invoice ? effectiveInvoiceStatus(invoice) : null;
  if (normalized === 'paid' || effectiveStatus === 'PAID') {
    return SESSION_STATES.PAID;
  }
  if (effectiveStatus === 'EXPIRED' || effectiveStatus === 'CANCELLED' || normalized === 'expired') {
    return SESSION_STATES.UNAVAILABLE;
  }
  if (normalized === 'rejected' || normalized === 'error') {
    return SESSION_STATES.REJECTED;
  }
  return SESSION_STATES.READY;
}

/** Initial session snapshot for tests and pure consumers. */
function initialSessionState(invoice, options = {}) {
  const status = invoice
    ? deriveSessionStatus({
        loading: false,
        invoice,
        paymentStatus: invoice.paymentTxHash && invoice.status === 'PAID' ? 'paid' : 'ready',
      })
    : options.loading
      ? SESSION_STATES.LOADING
      : SESSION_STATES.READY;

  return {
    status,
    invoice: invoice ?? null,
    txHash: invoice?.paymentTxHash ?? null,
    error: null,
    isOutage: false,
  };
}

/**
 * Pure session reducer for focused unit tests and callers that want the
 * 7-mode vocabulary directly. The live pay page still dispatches through
 * `paymentReducer`; `deriveSessionStatus` maps that state into these modes.
 */
function sessionReducer(state, event) {
  switch (event?.type) {
    case 'LOAD_STARTED':
      return { ...state, status: SESSION_STATES.LOADING, error: null, isOutage: false };

    case 'INVOICE_LOADED':
    case 'POLL_RESULT': {
      const invoice = event.invoice ?? null;
      if (!invoice) return state;

      const effectiveStatus = effectiveInvoiceStatus(invoice);
      if (effectiveStatus === 'PAID') {
        return {
          ...state,
          status: SESSION_STATES.PAID,
          invoice,
          txHash: invoice.paymentTxHash ?? state.txHash,
          error: null,
          isOutage: false,
        };
      }
      if (effectiveStatus === 'EXPIRED' || effectiveStatus === 'CANCELLED') {
        return {
          ...state,
          status: SESSION_STATES.UNAVAILABLE,
          invoice,
          error: null,
          isOutage: false,
        };
      }
      if (state.status === SESSION_STATES.PAYING || state.status === SESSION_STATES.VERIFYING) {
        return { ...state, invoice };
      }
      return {
        ...state,
        status: SESSION_STATES.READY,
        invoice,
        error: null,
        isOutage: false,
      };
    }

    case 'LOAD_FAILED':
      return {
        ...state,
        status: SESSION_STATES.UNAVAILABLE,
        error: event.error ?? 'Failed to load invoice',
        isOutage: Boolean(event.isOutage),
      };

    case 'PAY_STARTED':
      if (isTerminalSessionStatus(state.status)) return state;
      return { ...state, status: SESSION_STATES.PAYING, error: null };

    case 'PAY_SENT':
      if (isTerminalSessionStatus(state.status)) return state;
      return {
        ...state,
        status: SESSION_STATES.VERIFYING,
        txHash: event.txHash ?? state.txHash,
        error: null,
      };

    case 'PAY_FAILED':
      if (isTerminalSessionStatus(state.status)) return state;
      return { ...state, status: SESSION_STATES.REJECTED, error: event.error ?? 'Payment failed' };

    case 'VERIFY_STARTED':
      if (isTerminalSessionStatus(state.status)) return state;
      return {
        ...state,
        status: SESSION_STATES.VERIFYING,
        txHash: event.txHash ?? state.txHash,
        error: null,
      };

    case 'VERIFY_SUCCEEDED':
      return {
        ...state,
        status: SESSION_STATES.PAID,
        invoice: event.invoice ?? state.invoice,
        txHash: event.invoice?.paymentTxHash ?? event.txHash ?? state.txHash,
        error: null,
        isOutage: false,
      };

    case 'VERIFY_FAILED':
      if (isTerminalSessionStatus(state.status)) return state;
      return {
        ...state,
        status: SESSION_STATES.REJECTED,
        error: event.error ?? 'Verification failed',
      };

    // Outage is not a rejection: return to ready so the payer keeps verify
    // and can retry. Matches payment-page-state VERIFY_UNAVAILABLE behaviour.
    case 'VERIFY_UNAVAILABLE':
      if (isTerminalSessionStatus(state.status)) return state;
      return { ...state, status: SESSION_STATES.READY, isOutage: true, error: null };

    case 'RESET':
      if (isTerminalSessionStatus(state.status)) return state;
      return { ...state, status: SESSION_STATES.READY, error: null, isOutage: false };

    default:
      return state;
  }
}

function isSessionBusy(statusOrState) {
  const status = typeof statusOrState === 'object' ? statusOrState?.status : statusOrState;
  return status === SESSION_STATES.PAYING || status === SESSION_STATES.VERIFYING;
}

function isSessionResult(statusOrState) {
  const status = typeof statusOrState === 'object' ? statusOrState?.status : statusOrState;
  return (
    status === SESSION_STATES.PAID ||
    status === SESSION_STATES.REJECTED ||
    status === SESSION_STATES.UNAVAILABLE
  );
}

/** Whether background status polling should stay active for this session. */
function shouldSessionPoll(state) {
  if (!state?.invoice) return false;
  if (isTerminalSessionStatus(state.status)) return false;
  return shouldPoll({
    status:
      state.status === SESSION_STATES.READY
        ? 'idle'
        : state.status === SESSION_STATES.REJECTED
          ? 'error'
          : state.status,
    invoice: state.invoice,
    txHash: state.txHash ?? null,
    error: state.error ?? null,
  });
}

function asSentence(text) {
  const trimmed = (text ?? '').trim();
  if (!trimmed) return '';
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

/** Assistive-technology announcement for a session state. */
function describeSessionState(state) {
  switch (state?.status) {
    case SESSION_STATES.LOADING:
      return 'Loading invoice details. Please wait.';
    case SESSION_STATES.PAYING:
      return 'Opening your wallet. Confirm the payment in Freighter.';
    case SESSION_STATES.VERIFYING:
      return 'Verifying your payment on the Stellar network. This takes a few seconds.';
    case SESSION_STATES.PAID:
      return 'Payment confirmed. Your payment proof is ready to download.';
    case SESSION_STATES.UNAVAILABLE:
      return state?.error
        ? `This invoice is unavailable. ${asSentence(state.error)}`
        : 'This invoice is unavailable for payment.';
    case SESSION_STATES.REJECTED:
      return state?.error
        ? `Payment could not be completed. ${asSentence(state.error)}`
        : 'Payment could not be completed.';
    default:
      return '';
  }
}

module.exports = {
  SESSION_STATES,
  TERMINAL_SESSION_STATUSES,
  isTerminalSessionStatus,
  deriveSessionStatus,
  initialSessionState,
  sessionReducer,
  isSessionBusy,
  isSessionResult,
  shouldSessionPoll,
  describeSessionState,
};
