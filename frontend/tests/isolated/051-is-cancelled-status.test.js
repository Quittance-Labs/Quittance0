const test = require('node:test');
const assert = require('node:assert/strict');

function isCancelled(status) {
  return status === 'CANCELLED';
}

test('returns true for CANCELLED', () => {
  assert.equal(isCancelled('CANCELLED'), true);
});

test('returns false for other status spellings', () => {
  assert.equal(isCancelled('PENDING'), false);
  assert.equal(isCancelled('cancelled'), false);
});
