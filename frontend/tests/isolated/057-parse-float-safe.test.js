const test = require('node:test');
const assert = require('node:assert/strict');

function parseFloatSafe(value) {
  if (value === null || value === undefined) {
    return 0;
  }
  const parsed = parseFloat(value);
  return isNaN(parsed) ? 0 : parsed;
}

test('parses a valid numeric amount string correctly', () => {
  assert.equal(parseFloatSafe('123.45'), 123.45);
  assert.equal(parseFloatSafe('0'), 0);
});

test('handles invalid numeric amount strings and non-string inputs safely', () => {
  assert.equal(parseFloatSafe(''), 0);
  assert.equal(parseFloatSafe('abc'), 0);
  assert.equal(parseFloatSafe('   '), 0);
  assert.equal(parseFloatSafe(null), 0);
  assert.equal(parseFloatSafe(undefined), 0);
});
