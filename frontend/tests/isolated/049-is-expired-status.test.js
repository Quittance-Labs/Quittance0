const test = require('node:test');
const assert = require('node:assert/strict');

function isExpired(status) {
  return status === 'EXPIRED';
}

test('returns true for EXPIRED', () => {
  assert.equal(isExpired('EXPIRED'), true);
});

test('returns false for other status spellings', () => {
  assert.equal(isExpired('PENDING'), false);
  assert.equal(isExpired('expired'), false);
});
