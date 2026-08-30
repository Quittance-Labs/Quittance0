/**
 * Exhaustive status matrix for the pay-page control helpers.
 *
 * `payment-page-state.test.js` covers the headline cases; this file walks every
 * invoice status the backend can return, including ones the pay page has never
 * been asserted against. The two helpers decide whether the page offers pay and
 * manual-verify at all, so a regression here silently re-enables payment on an
 * invoice that must not accept one.
 *
 * Deeper polling and verify-error transitions are not covered yet: that logic
 * still lives inside `app/pay/[id]/page.tsx` and only becomes unit-testable
 * once it is extracted into a state module (issue #231).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  isExpiredInvoice,
  shouldShowPaymentControls,
  getPayPageView,
} = require('../lib/payment-page-state');
const { statusText, statusBadgeLabel, statusAnnouncement } = require('../lib/a11y');

/** Every status the backend's invoice model can produce. */
const ALL_STATUSES = ['PENDING', 'PAID', 'EXPIRED', 'CANCELLED'];

test('only EXPIRED is treated as expired', () => {
  for (const status of ALL_STATUSES) {
    assert.equal(
      isExpiredInvoice(status),
      status === 'EXPIRED',
      `${status} was classified incorrectly`
    );
  }
});

test('a PENDING status with elapsed expiresAt is treated as expired', () => {
  const invoice = { status: 'PENDING', expiresAt: '2000-01-01T00:00:00.000Z' };
  assert.equal(isExpiredInvoice(invoice), true);
  assert.equal(shouldShowPaymentControls(invoice), false);
});

test('an unknown or missing status is not treated as expired', () => {
  assert.equal(isExpiredInvoice(undefined), false);
  assert.equal(isExpiredInvoice(null), false);
  assert.equal(isExpiredInvoice(''), false);
  assert.equal(isExpiredInvoice('SOMETHING_NEW'), false);
});

test('payment controls are offered for exactly one status', () => {
  const offered = ALL_STATUSES.filter((status) => shouldShowPaymentControls(status));

  assert.deepEqual(
    offered,
    ['PENDING'],
    'only a pending invoice may still be paid'
  );
});

test('a recorded transaction hash withdraws the controls on every status', () => {
  for (const status of ALL_STATUSES) {
    assert.equal(
      shouldShowPaymentControls(status, 'b3a1f0c9'),
      false,
      `${status} still offered payment despite an existing transaction`
    );
  }
});

test('an empty transaction hash does not count as already paid', () => {
  // A falsy hash is "no payment recorded yet", not "payment in progress".
  assert.equal(shouldShowPaymentControls('PENDING', ''), true);
  assert.equal(shouldShowPaymentControls('PENDING', undefined), true);
  assert.equal(shouldShowPaymentControls('PENDING', null), true);
});

test('an unknown status never offers payment controls', () => {
  // Statuses added on the backend must fail closed, not open.
  assert.equal(shouldShowPaymentControls('SOMETHING_NEW'), false);
  assert.equal(shouldShowPaymentControls(undefined), false);
});

test('component visibility is derived consistently for every invoice status', () => {
  const matrix = Object.fromEntries(
    ALL_STATUSES.map((status) => [status, getPayPageView({ status, paymentTxHash: status === 'PAID' ? 'hash' : undefined })])
  );

  assert.equal(matrix.PENDING.showPaymentControls, true);
  assert.equal(matrix.PENDING.showMonitor, true);
  assert.equal(matrix.PAID.showProof, true);
  assert.equal(matrix.EXPIRED.expired, true);
  assert.equal(matrix.CANCELLED.showPaymentControls, false);
});

/*
 * Text equivalents (issue #289).
 *
 * The same statuses drive three colour-only indicators — the pay page's dot,
 * the dashboard card's pill and the detail page's icon. The matrix above proves
 * each status routes to the right controls; these prove each one also has words
 * behind it, so status never depends on seeing a colour.
 */

test('every status has a distinct, non-empty text equivalent', () => {
  const labels = ALL_STATUSES.map((status) => statusText(status).label);

  for (const [index, status] of ALL_STATUSES.entries()) {
    assert.ok(labels[index], `${status} has no label`);
  }

  assert.equal(
    new Set(labels).size,
    ALL_STATUSES.length,
    'two statuses share a label, so they are indistinguishable without colour'
  );
});

test('every status description is a sentence a live region can read', () => {
  for (const status of ALL_STATUSES) {
    const { description } = statusText(status);
    assert.ok(description.length > 10, `${status} description is too terse to be read aloud`);
    assert.ok(description.endsWith('.'), `${status} description is not a sentence`);
  }
});

test('a status badge label names the status it stands for', () => {
  for (const status of ALL_STATUSES) {
    assert.equal(statusBadgeLabel(status), `Invoice status: ${statusText(status).label}`);
  }
});

test('a status announcement carries both the label and the explanation', () => {
  for (const status of ALL_STATUSES) {
    const { label, description } = statusText(status);
    assert.equal(statusAnnouncement(status), `${label}. ${description}`);
  }
});

test('an unrecognised status still says something rather than nothing', () => {
  // A badge with no text equivalent reads as a bare coloured rectangle, which
  // is worse than an honest "Unknown".
  for (const value of ['SOMETHING_NEW', '', null, undefined]) {
    const { label, description } = statusText(value);
    assert.equal(label, 'Unknown');
    assert.ok(description);
  }
});

test('status lookup is case insensitive, as the dashboard filter needs', () => {
  // The dashboard holds its filter in lower case and reuses the same lookup.
  for (const status of ALL_STATUSES) {
    assert.deepEqual(statusText(status.toLowerCase()), statusText(status));
  }
});
