const test = require('node:test');
const assert = require('node:assert/strict');
const {
  assertPaymentProofAvailable,
  canExportPaymentProof,
} = require('../lib/payment-proof-policy');

test('only a paid invoice can produce a payment proof', () => {
  assert.equal(canExportPaymentProof({ status: 'PAID' }), true);
  assert.equal(canExportPaymentProof({ status: 'PENDING' }), false);
  assert.equal(canExportPaymentProof({ status: 'EXPIRED' }), false);
});

test('unpaid expired invoices cannot download or email proof', () => {
  assert.throws(
    () => assertPaymentProofAvailable({ status: 'EXPIRED' }),
    /expired unpaid/
  );
});

test('paid proof remains available', () => {
  assert.doesNotThrow(() => assertPaymentProofAvailable({ status: 'PAID' }));
});
