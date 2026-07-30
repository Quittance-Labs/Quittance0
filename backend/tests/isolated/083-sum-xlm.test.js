import test from 'node:test';
import assert from 'node:assert/strict';

const sumXlmAmounts = (entries) =>
  entries
    .filter(({ assetCode }) => assetCode === 'XLM')
    .reduce((total, { amount }) => total + amount, 0);

test('sums amounts for XLM entries only', () => {
  const entries = [
    { assetCode: 'XLM', amount: 12 },
    { assetCode: 'USDC', amount: 100 },
    { assetCode: 'XLM', amount: 8 },
  ];

  assert.equal(sumXlmAmounts(entries), 20);
});

test('returns zero when there are no XLM entries', () => {
  assert.equal(sumXlmAmounts([{ assetCode: 'USDC', amount: 100 }]), 0);
});
