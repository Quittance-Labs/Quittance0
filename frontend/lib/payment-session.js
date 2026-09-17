/**
 * Payment session state machine and helpers.
 *
 * Drives the pay page user experience through one unified session model:
 * loading, ready, paying, verifying, paid, rejected, unavailable.
 */

const { effectiveInvoiceStatus } = require('./invoice-lifecycle');
const { isTerminalPayState } = require('./pay-terminal-guard.ts');

/**
 * Canonical session state identifiers.
 */
const SESSION_STATES = Object.freeze({
  LOADING: 'loading',
  READY: 'ready',
  PAYING: 'paying',
  VERIFYING: 'verifying',
  PAID: 'paid',
  REJECTED: 'rejected',
  UNAVAILABLE: 'unavailable',
});

/**
 * Terminal session statuses that cannot be overridden by non-ledger transitions.
 */
const TERMINAL_SESSION_STATUSES = Object.freeze([
  SESSION_STATES.PAID,
  SESSION_STATES.UNAVAILABLE,
]);

/**
 * Checks whether a session status is terminal.
 *
 * @param {string} status
 * @returns {boolean}
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
 * Derives the active payment session status from invoice lifecycle and payment flow.
 *
 * @param {object} params
 * @param {boolean} [params.loading]
 * @param {object} [params.invoice]
 * @param {string} [params.paymentStatus]
 * @param {string} [params.loadError]
 * @param {boolean} [params.isOutage]
 * @returns {string}
 */
function deriveSessionStatus({ loading, invoice, paymentStatus, loadError }) {
  if (loading && !invoice) {
    return SESSION_STATES.LOADING;
  }
  if (!invoice && loadError) {
    return SESSION_STATES.UNAVAILABLE;
  }
  if (paymentStatus === 'paying' || paymentStatus === 'PAYING') {
    return SESSION_STATES.PAYING;
  }
  if (paymentStatus === 'verifying' || paymentStatus === 'VERIFYING') {
    return SESSION_STATES.VERIFYING;
  }
  const effectiveStatus = invoice ? effectiveInvoiceStatus(invoice) : null;
  if (paymentStatus === 'paid' || paymentStatus === 'PAID' || effectiveStatus === 'PAID') {
    return SESSION_STATES.PAID;
  }
  if (effectiveStatus === 'EXPIRED' || effectiveStatus === 'CANCELLED') {
    return SESSION_STATES.UNAVAILABLE;
  }
  if (
    paymentStatus === 'rejected' ||
    paymentStatus === 'REJECTED' ||
    paymentStatus === 'error' ||
    paymentStatus === 'ERROR'
  ) {
    return SESSION_STATES.REJECTED;
  }
  return SESSION_STATES.READY;
}

/**
 * Builds the initial session state object.
 *
 * @param {object} [invoice]
 * @param {object} [options]
 * @returns {object}
 */
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
 * Pure reducer for payment session state transitions.
 *
 * @param {object} state
 * @param {object} event
 * @returns {object}
 */
function sessionReducer(state, event) {
  switch (event?.type) {
    case 'LOAD_STARTED':
      return {
        ...state,
        status: SESSION_STATES.LOADING,
        error: null,
        isOutage: false,
      };

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
      return {
        ...state,
        status: SESSION_STATES.PAYING,
        error: null,
      };

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
      return {
        ...state,
        status: SESSION_STATES.REJECTED,
        error: event.error ?? 'Payment failed',
      };

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

    case 'VERIFY_UNAVAILABLE':
      if (isTerminalSessionStatus(state.status)) return state;
      return {
        ...state,
        status: SESSION_STATES.READY,
        isOutage: true,
        error: null,
      };

    case 'RESET':
      if (isTerminalSessionStatus(state.status)) return state;
      return {
        ...state,
        status: SESSION_STATES.READY,
        error: null,
        isOutage: false,
      };

    default:
      return state;
  }
}

/**
 * Checks whether the session status represents an active background operation.
 *
 * @param {object|string} statusOrState
 * @returns {boolean}
 */
function isSessionBusy(statusOrState) {
  const status = typeof statusOrState === 'object' ? statusOrState?.status : statusOrState;
  return status === SESSION_STATES.PAYING || status === SESSION_STATES.VERIFYING;
}

/**
 * Checks whether the session status represents a definitive result state.
 *
 * @param {object|string} statusOrState
 * @returns {boolean}
 */
function isSessionResult(statusOrState) {
  const status = typeof statusOrState === 'object' ? statusOrState?.status : statusOrState;
  return (
    status === SESSION_STATES.PAID ||
    status === SESSION_STATES.REJECTED ||
    status === SESSION_STATES.UNAVAILABLE
  );
}

/**
 * Determines whether polling should be active for a session.
 *
 * @param {object} state
 * @returns {boolean}
 */
function shouldSessionPoll(state) {
  if (!state?.invoice) return false;
  if (isTerminalSessionStatus(state.status)) return false;
  return effectiveInvoiceStatus(state.invoice) === 'PENDING';
}

/**
 * Formats a clause as a complete grammatical sentence.
 *
 * @param {string} text
 * @returns {string}
 */
function asSentence(text) {
  const trimmed = (text ?? '').trim();
  if (!trimmed) return '';
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

/**
 * Generates an announcement sentence for assistive technologies based on session state.
 *
 * @param {object} state
 * @returns {string}
 */
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
