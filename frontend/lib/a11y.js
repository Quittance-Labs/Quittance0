/**
 * Shared accessibility contract for the core pages (issue #289).
 *
 * Status is communicated visually in three different places — a coloured dot on
 * the pay page, a coloured pill on the dashboard card, and a coloured icon on
 * the invoice detail page. Colour is the only thing that distinguishes them, so
 * each one needs the same text equivalent, and it has to be the *same* text or
 * the three drift apart the way the payer-email check once did.
 *
 * This module is the single source of that text, plus the two other things the
 * pages have to agree on: which element ids the async result panels use, and how
 * loudly a given result is announced.
 *
 * Plain CommonJS with a sibling `.d.ts`, matching `verification.js` and
 * `payment-page-state.js`, so `node --test` can require it without a build step.
 */

/**
 * Text equivalents for every invoice status the backend can return.
 *
 * `label` is the short name a badge exposes; `description` is the sentence a
 * live region or status panel reads out.
 */
const INVOICE_STATUS_TEXT = Object.freeze({
  PENDING: Object.freeze({
    label: 'Pending',
    description: 'Waiting for payment.',
  }),
  PAID: Object.freeze({
    label: 'Paid',
    description: 'This invoice has been paid.',
  }),
  EXPIRED: Object.freeze({
    label: 'Expired',
    description: 'This invoice has expired and can no longer be paid.',
  }),
  CANCELLED: Object.freeze({
    label: 'Cancelled',
    description: 'This invoice has been cancelled.',
  }),
});

/**
 * Used when the backend grows a status the frontend has not shipped support for
 * yet. An unknown status still has to say something, because a badge that reads
 * only as a coloured rectangle tells a screen-reader user nothing at all.
 */
const UNKNOWN_STATUS_TEXT = Object.freeze({
  label: 'Unknown',
  description: 'This invoice has a status this page does not recognise.',
});

/** Text equivalent for a status, never null. */
function statusText(status) {
  const key = typeof status === 'string' ? status.toUpperCase() : '';
  return INVOICE_STATUS_TEXT[key] ?? UNKNOWN_STATUS_TEXT;
}

/** Short accessible name for a status badge, e.g. "Invoice status: Paid". */
function statusBadgeLabel(status) {
  return `Invoice status: ${statusText(status).label}`;
}

/** Full sentence for a status region, e.g. "Paid. This invoice has been paid." */
function statusAnnouncement(status) {
  const { label, description } = statusText(status);
  return `${label}. ${description}`;
}

/**
 * Ids that async result panels and the controls pointing at them share.
 *
 * They are constants rather than literals in the JSX because the focus effect,
 * the `aria-describedby` that references the panel and the test that asserts
 * focus landed all have to name the same element.
 */
const MAIN_CONTENT_ID = 'main-content';
const PAYMENT_RESULT_ID = 'payment-result';
const CREATED_INVOICE_ID = 'created-invoice';
const DASHBOARD_RESULTS_ID = 'dashboard-results';

/**
 * How loudly to announce a result.
 *
 * A failure interrupts whatever the screen reader is saying, because the payer
 * is waiting on that answer and everything below it is now stale. Success and
 * progress wait their turn.
 */
function announcementPoliteness(kind) {
  return kind === 'error' ? 'assertive' : 'polite';
}

/**
 * The ARIA role that matches a politeness level.
 *
 * `role="alert"` is an assertive live region and `role="status"` is a polite
 * one, so picking the role and picking the politeness is one decision.
 */
function announcementRole(kind) {
  return kind === 'error' ? 'alert' : 'status';
}

/**
 * Describes an amount the way it should be read aloud.
 *
 * The pay page renders the amount with `bg-clip-text text-transparent`, and the
 * dashboard splits it across two elements. Both read badly, so both get this as
 * an explicit accessible name.
 */
function describeAmount(amount, assetCode) {
  const code = (assetCode ?? '').trim();
  return code ? `${amount} ${code}` : `${amount}`;
}

/**
 * Explains why a control is unavailable, or null when it is available.
 *
 * Pairing this with `aria-disabled` rather than `disabled` keeps the control
 * reachable by keyboard, so the reason can actually be heard. A `disabled`
 * button is skipped by the tab order and its `title` is never announced, which
 * is why "email proof" looked broken rather than unavailable.
 */
function unavailableReason(available, reason) {
  return available ? null : reason;
}

module.exports = {
  INVOICE_STATUS_TEXT,
  UNKNOWN_STATUS_TEXT,
  statusText,
  statusBadgeLabel,
  statusAnnouncement,
  MAIN_CONTENT_ID,
  PAYMENT_RESULT_ID,
  CREATED_INVOICE_ID,
  DASHBOARD_RESULTS_ID,
  announcementPoliteness,
  announcementRole,
  describeAmount,
  unavailableReason,
};
