import test from 'node:test';
import assert from 'node:assert/strict';

const filterBySellerKey = (invoices, sellerKey) =>
  invoices.filter((invoice) => invoice.sellerKey === sellerKey);

test('filters invoices by seller key', () => {
  const invoices = [
    { id: 'inv-1', sellerKey: 'seller-a' },
    { id: 'inv-2', sellerKey: 'seller-b' },
    { id: 'inv-3', sellerKey: 'seller-a' },
  ];

  assert.deepEqual(filterBySellerKey(invoices, 'seller-a'), [
    { id: 'inv-1', sellerKey: 'seller-a' },
    { id: 'inv-3', sellerKey: 'seller-a' },
  ]);
});

test('returns an empty array when no seller key matches', () => {
  assert.deepEqual(filterBySellerKey([{ id: 'inv-1', sellerKey: 'seller-a' }], 'seller-c'), []);
});
