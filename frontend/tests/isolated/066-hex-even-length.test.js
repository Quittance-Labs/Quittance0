const test = require('node:test');
const assert = require('node:assert/strict');

const hasEvenHexLength = (value) => value.length % 2 === 0;

test('accepts a hex string with even length', () => {
  assert.equal(hasEvenHexLength('0a1b'), true);
});

test('rejects a hex string with odd length', () => {
  assert.equal(hasEvenHexLength('abc'), false);
});
