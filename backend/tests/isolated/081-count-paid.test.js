const test = require('node:test');
const assert = require('node:assert/strict');

// Minimal in-file helper: count PAID invoices in a list
function countPaid(invoices) {
  if (!invoices || !Array.isArray(invoices)) {
    return 0;
  }
  return invoices.filter(inv => inv && inv.status === 'PAID').length;
}

test('countPaid helper', async (t) => {
  await t.test('counts only PAID invoices (happy path)', () => {
    const invoices = [
      { id: 1, status: 'PAID' },
      { id: 2, status: 'UNPAID' },
      { id: 3, status: 'PAID' }
    ];
    assert.equal(countPaid(invoices), 2);
  });

  await t.test('handles empty list or no paid invoices (edge case)', () => {
    assert.equal(countPaid([]), 0);
    assert.equal(countPaid([{ id: 1, status: 'DRAFT' }]), 0);
    assert.equal(countPaid(null), 0);
  });
});
