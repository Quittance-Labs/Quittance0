const test = require('node:test');
const assert = require('node:assert/strict');

function isDecimalString(value) {
  return /^\d+(\.\d+)?$/.test(value);
}

test('accepts whole and fractional decimal strings', () => {
  assert.equal(isDecimalString('42'), true);
  assert.equal(isDecimalString('42.75'), true);
});

test('rejects incomplete and negative decimal strings', () => {
  assert.equal(isDecimalString('42.'), false);
  assert.equal(isDecimalString('-1'), false);
});
