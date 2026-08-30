/**
 * Pay-page state machine (issue #231).
 *
 * The pay page combines Freighter payment, background polling, manual hash
 * verification, payer metadata and expiry handling. Keeping those transitions
 * in the component made every one of them untestable and easy to regress, so
 * they live here as pure functions instead.
 *
 * States
 *
 *   idle ──PAY_STARTED──▶ paying ──PAY_SENT──▶ verifying ──VERIFY_SUCCEEDED──▶ paid
 *     │                      │                     │
 *     │                      └──PAY_FAILED─────────┴──VERIFY_FAILED──▶ error
 *     │                                                                  │
 *     ├──VERIFY_STARTED──▶ verifying                                     │
 *     │                                                                  │
 *     ◀──────────────────────── RESET ───────────────────────────────────┘
 *
 *   Any state ──INVOICE_LOADED / POLL_RESULT (PAID)────▶ paid
 *   Any state ──INVOICE_LOADED / POLL_RESULT (EXPIRED)─▶ expired
 *
 * `paid` and `expired` are terminal: the ledger has decided, and no local event
 * moves the page back out of them.
 */

/** Every state the pay page can be in. */
const PAY_STATES = Object.freeze({
  IDLE: 'idle',
  PAYING: 'paying',
  VERIFYING: 'verifying',
  PAID: 'paid',
  ERROR: 'error',
  EXPIRED: 'expired',
});

const TERMINAL_STATES = Object.freeze([PAY_STATES.PAID, PAY_STATES.EXPIRED]);

const isExpiredInvoice = (status) => status === 'EXPIRED';

const shouldShowPaymentControls = (status, paymentTxHash) => {
  if (isExpiredInvoice(status)) {
    return false;
  }

  return status === 'PENDING' && !paymentTxHash;
};

/** Stable presentation flags shared by the route and component-level tests. */
function getPayPageView(invoice) {
  const status = invoice?.status;
  return {
    expired: isExpiredInvoice(status),
    paid: status === 'PAID',
    showPaymentControls: shouldShowPaymentControls(status, invoice?.paymentTxHash),
    showProof: status === 'PAID' && Boolean(invoice?.paymentTxHash),
    showMonitor: status === 'PENDING' && !invoice?.paymentTxHash,
  };
}

/** Maps an invoice status onto the state it forces, or null if it forces none. */
function stateForStatus(status) {
  if (status === 'PAID') return PAY_STATES.PAID;
  if (isExpiredInvoice(status)) return PAY_STATES.EXPIRED;
  return null;
}

function initialPaymentState(invoice) {
  return {
    status: invoice ? stateForStatus(invoice.status) ?? PAY_STATES.IDLE : PAY_STATES.IDLE,
    invoice: invoice ?? null,
    txHash: invoice?.paymentTxHash ?? null,
    error: null,
  };
}

/**
 * Applies an event to the state.
 *
 * Unknown events return the same object reference, so a stray dispatch cannot
 * cause a re-render.
 */
function paymentReducer(state, event) {
  switch (event?.type) {
    // The ledger's answer always wins over any local state.
    case 'INVOICE_LOADED':
    case 'POLL_RESULT': {
      const invoice = event.invoice ?? null;
      const forced = invoice ? stateForStatus(invoice.status) : null;

      if (forced) {
        return {
          status: forced,
          invoice,
          txHash: invoice.paymentTxHash ?? state.txHash,
          error: null,
        };
      }

      // A still-pending invoice must not interrupt an in-flight attempt.
      if (state.status === PAY_STATES.PAYING || state.status === PAY_STATES.VERIFYING) {
        return { ...state, invoice };
      }

      return { ...state, status: PAY_STATES.IDLE, invoice, error: null };
    }

    case 'PAY_STARTED':
      if (TERMINAL_STATES.includes(state.status)) return state;
      return { ...state, status: PAY_STATES.PAYING, error: null };

    case 'PAY_SENT':
      if (TERMINAL_STATES.includes(state.status)) return state;
      return {
        ...state,
        status: PAY_STATES.VERIFYING,
        txHash: event.txHash ?? state.txHash,
        error: null,
      };

    case 'PAY_FAILED':
      if (TERMINAL_STATES.includes(state.status)) return state;
      return { ...state, status: PAY_STATES.ERROR, error: event.error ?? 'Payment failed' };

    case 'VERIFY_STARTED':
      if (TERMINAL_STATES.includes(state.status)) return state;
      return { ...state, status: PAY_STATES.VERIFYING, error: null };

    case 'VERIFY_SUCCEEDED':
      return {
        status: PAY_STATES.PAID,
        invoice: event.invoice ?? state.invoice,
        txHash: event.invoice?.paymentTxHash ?? event.txHash ?? state.txHash,
        error: null,
      };

    case 'VERIFY_FAILED':
      if (TERMINAL_STATES.includes(state.status)) return state;
      return { ...state, status: PAY_STATES.ERROR, error: event.error ?? 'Verification failed' };

    case 'RESET':
      if (TERMINAL_STATES.includes(state.status)) return state;
      return { ...state, status: PAY_STATES.IDLE, error: null };

    default:
      return state;
  }
}

/**
 * Whether the page should keep asking the backend for a status change.
 *
 * Polling exists to notice a payment the page did not make itself, so it stops
 * as soon as the answer is known and never runs against a terminal state.
 */
function shouldPoll(state) {
  if (!state?.invoice) return false;
  if (TERMINAL_STATES.includes(state.status)) return false;
  return state.invoice.status === 'PENDING';
}

/** Email shape accepted for payer metadata. Mirrors the backend's own check. */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Normalises optional payer details.
 *
 * This is the single definition of what a valid payer email is on the client.
 * It previously existed three times — in the page, in `PaymentButton`, and in
 * the backend — which is exactly how the three drift apart.
 */
function normalizePayerDetails(details) {
  const payerName = (details?.payerName ?? '').trim();
  const payerEmail = (details?.payerEmail ?? '').trim();

  if (payerEmail && !EMAIL_PATTERN.test(payerEmail)) {
    return { ok: false, error: 'Enter a valid payer email' };
  }

  return {
    ok: true,
    value: {
      payerName: payerName || undefined,
      payerEmail: payerEmail || undefined,
    },
  };
}

/**
 * Turns a failed verification into something worth showing a payer.
 *
 * The backend's own message is the most specific thing available — "Memo
 * mismatch" tells a payer far more than "Verification failed" — so it is
 * preferred, with the transport message and a generic fallback behind it.
 */
function describeVerifyError(error, fallback = 'Verification failed') {
  return error?.response?.data?.error || error?.message || fallback;
}

/** True when a transaction hash looks like one, before any request is made. */
function isLikelyTransactionHash(value) {
  return /^[a-fA-F0-9]{64}$/.test((value ?? '').trim());
}

module.exports = {
  PAY_STATES,
  TERMINAL_STATES,
  isExpiredInvoice,
  shouldShowPaymentControls,
  getPayPageView,
  stateForStatus,
  initialPaymentState,
  paymentReducer,
  shouldPoll,
  normalizePayerDetails,
  describeVerifyError,
  isLikelyTransactionHash,
};
