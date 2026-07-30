const test = require('node:test');
const assert = require('node:assert/strict');

function isPending(status) {
  return status === 'PENDING';
}

test('returns true for PENDING', () => {
  assert.equal(isPending('PENDING'), true);
});

test('returns false for other status spellings', () => {
  assert.equal(isPending('PAID'), false);
  assert.equal(isPending('pending'), false);
});
