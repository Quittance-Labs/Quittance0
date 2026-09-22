/**
 * Builds the chronological event list for the seller invoice workspace's
 * timeline (issue #454): created, awaiting-payment/expired, cancelled, and
 * paid, including the late-payment flag when payment settles after the
 * invoice's expiry or cancellation.
 *
 * Kept as a pure function over the invoice DTO, separate from the
 * `InvoiceTimeline` component that renders it, so the event-selection logic
 * (which events apply, in what order) is unit-testable without mounting any
 * React component.
 */

const { hasInvoiceExpired } = require('./invoice-lifecycle.js');

/**
 * @typedef {{
 *   type: 'created' | 'awaiting-payment' | 'expired' | 'cancelled' | 'paid',
 *   label: string,
 *   timestamp: string | null,
 *   deadline?: string,
 *   payerPublicKey?: string,
 *   paymentTxHash?: string,
 *   lateWarningCode?: 'PAYMENT_RECEIVED_AFTER_EXPIRY' | 'PAYMENT_RECEIVED_AFTER_CANCEL' | null,
 * }} InvoiceTimelineEvent
 */

/**
 * @param {object | null | undefined} invoice
 * @param {number} [now]
 * @returns {InvoiceTimelineEvent[]} Oldest first; the current, still-ongoing
 *   "awaiting payment" state (if applicable) sorts last since it has no
 *   timestamp of its own to order by.
 */
function buildInvoiceTimelineEvents(invoice, now = Date.now()) {
  if (!invoice) return [];

  const events = [];

  events.push({
    type: 'created',
    label: 'Invoice created',
    timestamp: invoice.createdAt ?? null,
  });

  const wasCancelled = Boolean(invoice.cancelledAt);
  const wasExpired =
    invoice.priorStatus === 'EXPIRED' ||
    invoice.settlementContext === 'AFTER_EXPIRY' ||
    invoice.latePaymentWarningCode === 'PAYMENT_RECEIVED_AFTER_EXPIRY';
  const paidAt = invoice.settledAt ?? invoice.paidAt ?? null;
  const isPaid = invoice.status === 'PAID' && Boolean(paidAt);

  if (wasCancelled) {
    events.push({
      type: 'cancelled',
      label: 'Invoice cancelled',
      timestamp: invoice.cancelledAt,
    });
  } else if (wasExpired || (!isPaid && hasInvoiceExpired(invoice, now))) {
    events.push({
      type: 'expired',
      label: 'Invoice expired',
      timestamp: invoice.expiresAt ?? null,
    });
  } else if (!isPaid) {
    events.push({
      type: 'awaiting-payment',
      label: 'Awaiting payment',
      timestamp: null,
      deadline: invoice.expiresAt,
    });
  }

  if (isPaid) {
    events.push({
      type: 'paid',
      label: 'Payment settled',
      timestamp: paidAt,
      payerPublicKey: invoice.payerPublicKey ?? undefined,
      paymentTxHash: invoice.paymentTxHash ?? undefined,
      lateWarningCode: invoice.latePaymentWarningCode ?? null,
    });
  }

  return events.sort((a, b) => {
    if (!a.timestamp) return 1;
    if (!b.timestamp) return -1;
    return new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
  });
}

module.exports = { buildInvoiceTimelineEvents };
