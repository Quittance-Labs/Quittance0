const test = require('node:test');
const assert = require('node:assert/strict');

const INVOICE_STATUSES = new Set(['PENDING', 'PAID', 'EXPIRED', 'CANCELLED']);

function isInvoiceStatus(status) {
  return INVOICE_STATUSES.has(status);
}

test('accepts each supported invoice status', () => {
  for (const status of INVOICE_STATUSES) {
    assert.equal(isInvoiceStatus(status), true);
  }
});

test('rejects values outside the supported invoice statuses', () => {
  assert.equal(isInvoiceStatus('REFUNDED'), false);
  assert.equal(isInvoiceStatus('pending'), false);
  assert.equal(isInvoiceStatus(undefined), false);
});
