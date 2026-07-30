const test = require('node:test');
const assert = require('node:assert/strict');

function formatAmount(value) {
  return Number.parseFloat(value).toFixed(2);
}

test('formats a decimal amount string to two places', () => {
  assert.equal(formatAmount('12.5'), '12.50');
});

test('rounds extra decimal places', () => {
  assert.equal(formatAmount('12.346'), '12.35');
});
