const test = require('node:test');
const assert = require('node:assert/strict');

const bothFlags = (left, right) => left && right;

test('returns true when both flags are true', () => {
  assert.equal(bothFlags(true, true), true);
});

test('returns false when either flag is false', () => {
  assert.equal(bothFlags(false, true), false);
  assert.equal(bothFlags(true, false), false);
});
