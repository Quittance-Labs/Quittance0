const test = require('node:test');
const assert = require('node:assert/strict');

function countPendingInvoices(invoices) {
  return invoices.filter(({ status }) => status === 'PENDING').length;
}

test('counts only PENDING invoices in a mixed list', () => {
  const invoices = [
    { status: 'PENDING' },
    { status: 'PAID' },
    { status: 'PENDING' },
    { status: 'EXPIRED' },
    { status: 'CANCELLED' },
  ];

  assert.equal(countPendingInvoices(invoices), 2);
});

test('returns zero when no invoice is pending', () => {
  assert.equal(countPendingInvoices([]), 0);
  assert.equal(countPendingInvoices([{ status: 'PAID' }]), 0);
});
