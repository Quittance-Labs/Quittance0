import test from 'node:test';
import assert from 'node:assert/strict';

const groupRevenueByAsset = (entries) =>
  entries.reduce((totals, { assetCode, revenue }) => {
    totals[assetCode] = (totals[assetCode] ?? 0) + revenue;
    return totals;
  }, {});

test('groups revenue totals by asset code', () => {
  const entries = [
    { assetCode: 'USD', revenue: 100 },
    { assetCode: 'EUR', revenue: 30 },
    { assetCode: 'USD', revenue: 25 },
  ];

  assert.deepEqual(groupRevenueByAsset(entries), { USD: 125, EUR: 30 });
});

test('returns an empty object for no revenue entries', () => {
  assert.deepEqual(groupRevenueByAsset([]), {});
});
