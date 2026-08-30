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
const { effectiveInvoiceStatus, hasInvoiceExpired } = require('./invoice-lifecycle');

const asInvoice = (statusOrInvoice) =>
  statusOrInvoice && typeof statusOrInvoice === 'object'
    ? statusOrInvoice
    : { status: statusOrInvoice };

const isExpiredInvoice = (statusOrInvoice, now) =>
  hasInvoiceExpired(asInvoice(statusOrInvoice), now);

const shouldShowPaymentControls = (statusOrInvoice, paymentTxHash, now) => {
  const invoice = asInvoice(statusOrInvoice);
  if (isExpiredInvoice(invoice, now)) {
    return false;
  }

  return invoice.status === 'PENDING' && !(paymentTxHash ?? invoice.paymentTxHash);
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
function stateForStatus(statusOrInvoice, now) {
  const status = effectiveInvoiceStatus(asInvoice(statusOrInvoice), now);
  if (status === 'PAID') return PAY_STATES.PAID;
  if (isExpiredInvoice(status)) return PAY_STATES.EXPIRED;
  return null;
}

function initialPaymentState(invoice) {
  return {
    status: invoice ? stateForStatus(invoice) ?? PAY_STATES.IDLE : PAY_STATES.IDLE,
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
      const forced = invoice ? stateForStatus(invoice) : null;

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
  return effectiveInvoiceStatus(state.invoice) === 'PENDING';
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

/**
 * The states that mean an asynchronous attempt is still running (issue #289).
 *
 * A sighted payer sees a spinner. Everyone else needs `aria-busy`, and the
 * result panel must not steal focus while the answer is still pending.
 */
function isBusyState(state) {
  return state?.status === PAY_STATES.PAYING || state?.status === PAY_STATES.VERIFYING;
}

/**
 * The states that carry an answer worth moving focus to (issue #289).
 *
 * Verification and background polling both finish without any keyboard event,
 * so the payer's focus is still on the Verify button — or nowhere at all —
 * when the answer lands. These are the transitions that justify taking focus.
 */
function isResultState(state) {
  return (
    state?.status === PAY_STATES.PAID ||
    state?.status === PAY_STATES.EXPIRED ||
    state?.status === PAY_STATES.ERROR
  );
}

/**
 * Whether a result should interrupt the screen reader.
 *
 * Only a failure does: the payer is blocked on it. A confirmed payment is good
 * news that can wait for a gap in the announcement queue.
 */
function paymentStateKind(state) {
  return state?.status === PAY_STATES.ERROR ? 'error' : 'status';
}

/**
 * Ends a clause with a full stop.
 *
 * Backend rejections arrive as fragments — "Memo mismatch", "Amount mismatch"
 * — and a live region reads its content straight through, so two announcements
 * run together into one breathless sentence without this.
 */
function asSentence(text) {
  const trimmed = (text ?? '').trim();
  if (!trimmed) return '';
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

/**
 * The sentence a live region reads when the pay page changes state.
 *
 * Every branch returns English prose rather than a state name, because this
 * text is read aloud verbatim — "verifying" on its own is not a sentence.
 */
function describePaymentState(state) {
  switch (state?.status) {
    case PAY_STATES.PAYING:
      return 'Opening your wallet. Confirm the payment in Freighter.';
    case PAY_STATES.VERIFYING:
      return 'Verifying your payment on the Stellar network. This takes a few seconds.';
    case PAY_STATES.PAID:
      return 'Payment confirmed. Your payment proof is ready to download.';
    case PAY_STATES.EXPIRED:
      return 'This invoice has expired and can no longer be paid.';
    case PAY_STATES.ERROR:
      return state?.error
        ? `Payment could not be completed. ${asSentence(state.error)}`
        : 'Payment could not be completed.';
    default:
      return '';
  }
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
  isBusyState,
  isResultState,
  paymentStateKind,
  describePaymentState,
};
