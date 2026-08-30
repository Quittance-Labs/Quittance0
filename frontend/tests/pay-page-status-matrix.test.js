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
} = require('../lib/payment-page-state');

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
