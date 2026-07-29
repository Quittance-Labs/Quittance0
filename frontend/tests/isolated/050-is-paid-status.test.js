const test = require('node:test');
const assert = require('node:assert/strict');

function isPaid(status) {
  return status === 'PAID';
}

test('returns true for PAID', () => {
  assert.equal(isPaid('PAID'), true);
});

test('returns false for other status spellings', () => {
  assert.equal(isPaid('PENDING'), false);
  assert.equal(isPaid('paid'), false);
});
