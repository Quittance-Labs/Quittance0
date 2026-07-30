const test = require('node:test');
const assert = require('node:assert/strict');

const eitherFlag = (left, right) => left || right;

test('returns true when either flag is true', () => {
  assert.equal(eitherFlag(true, false), true);
  assert.equal(eitherFlag(false, true), true);
});

test('returns false when both flags are false', () => {
  assert.equal(eitherFlag(false, false), false);
});
