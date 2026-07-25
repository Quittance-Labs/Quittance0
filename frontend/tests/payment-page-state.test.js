const test = require('node:test');
const assert = require('node:assert/strict');
const {
  isExpiredInvoice,
  shouldShowPaymentControls,
} = require('../lib/payment-page-state');

test('identifies an expired invoice', () => {
  assert.equal(isExpiredInvoice('EXPIRED'), true);
  assert.equal(isExpiredInvoice('PENDING'), false);
});

test('hides payment controls for an expired invoice', () => {
  assert.equal(shouldShowPaymentControls('EXPIRED'), false);
});

test('keeps payment controls available for an unpaid pending invoice', () => {
  assert.equal(shouldShowPaymentControls('PENDING'), true);
  assert.equal(shouldShowPaymentControls('PENDING', 'existing-transaction'), false);
});
