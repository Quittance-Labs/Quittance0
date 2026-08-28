const test = require('node:test');
const assert = require('node:assert/strict');
const {
  isExpiredInvoice,
  shouldShowPaymentControls,
  shouldStopPolling,
  getVerificationErrorMessage,
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

test('shouldStopPolling stops on non-pending or too many errors', () => {
  assert.equal(shouldStopPolling('PAID'), true);
  assert.equal(shouldStopPolling('EXPIRED'), true);
  assert.equal(shouldStopPolling('PENDING', 0), false);
  assert.equal(shouldStopPolling('PENDING', 5), true);
});

test('getVerificationErrorMessage extracts error properly', () => {
  assert.equal(getVerificationErrorMessage({}), 'Failed to verify transaction');
  assert.equal(getVerificationErrorMessage({ response: { status: 404 } }), 'Invoice not found');
  assert.equal(getVerificationErrorMessage({ response: { data: { error: 'Memo mismatch' } } }), 'Memo mismatch');
});
