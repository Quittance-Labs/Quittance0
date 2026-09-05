const test = require('node:test');
const assert = require('node:assert/strict');
const { sortKeyForInvoice } = require('../lib/history-sort-key.ts');
const { historySortKeyFixture } = require('./fixtures/history-sort-key.fixture.js');

for (const { input, expected } of historySortKeyFixture) {
  test(`sortKeyForInvoice generates ${expected} for ${JSON.stringify(input)}`, () => {
    assert.equal(sortKeyForInvoice(input), expected);
  });
}

test('sortKeyForInvoice produces stable sorting order for invoice list', () => {
  const invoices = [
    { id: 'inv-old', createdAt: '2026-08-01T00:00:00.000Z' },
    { id: 'inv-new', createdAt: '2026-08-15T00:00:00.000Z' },
    { id: 'inv-mid', createdAt: '2026-08-10T00:00:00.000Z' },
  ];

  const sortedDescending = [...invoices].sort((a, b) =>
    sortKeyForInvoice(b).localeCompare(sortKeyForInvoice(a))
  );

  assert.deepEqual(
    sortedDescending.map((inv) => inv.id),
    ['inv-new', 'inv-mid', 'inv-old']
  );
});

test('sortKeyForInvoice breaks timestamp ties deterministically with id', () => {
  const invoiceA = { id: 'a', createdAt: '2026-08-10T00:00:00.000Z' };
  const invoiceB = { id: 'b', createdAt: '2026-08-10T00:00:00.000Z' };

  assert.ok(sortKeyForInvoice(invoiceA) < sortKeyForInvoice(invoiceB));
});

test('sortKeyForInvoice handles non-object edge cases safely', () => {
  assert.equal(sortKeyForInvoice('string-invoice'), '');
  assert.equal(sortKeyForInvoice(12345), '');
  assert.equal(sortKeyForInvoice(true), '');
});
