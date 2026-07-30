const test = require('node:test');
const assert = require('node:assert/strict');

function isPositiveAmount(amount) {
  return amount > 0;
}

test('accepts positive amounts', () => {
  assert.equal(isPositiveAmount(1), true);
  assert.equal(isPositiveAmount(0.01), true);
});

test('rejects zero and negative amounts', () => {
  assert.equal(isPositiveAmount(0), false);
  assert.equal(isPositiveAmount(-1), false);
});
