import test from 'node:test';
import assert from 'node:assert/strict';

const sumUsdcAmounts = (entries) =>
  entries
    .filter(({ assetCode }) => assetCode === 'USDC')
    .reduce((total, { amount }) => total + amount, 0);

test('sums amounts for USDC entries only', () => {
  const entries = [
    { assetCode: 'USDC', amount: 25 },
    { assetCode: 'EURC', amount: 100 },
    { assetCode: 'USDC', amount: 15 },
  ];

  assert.equal(sumUsdcAmounts(entries), 40);
});

test('returns zero when there are no USDC entries', () => {
  assert.equal(sumUsdcAmounts([{ assetCode: 'EURC', amount: 100 }]), 0);
});
