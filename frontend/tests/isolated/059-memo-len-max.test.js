const test = require('node:test');
const assert = require('node:assert/strict');

const isMemoLengthValid = (memo) => Buffer.byteLength(memo, 'utf8') <= 28;

test('rejects a memo longer than 28 UTF-8 bytes', () => {
  assert.equal(isMemoLengthValid('a'.repeat(29)), false);
});

test('accepts a multibyte memo at the 28-byte boundary', () => {
  assert.equal(Buffer.byteLength('é'.repeat(14), 'utf8'), 28);
  assert.equal(isMemoLengthValid('é'.repeat(14)), true);
});
