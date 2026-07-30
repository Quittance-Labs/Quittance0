const test = require('node:test');
const assert = require('node:assert/strict');

const isMemoLengthValid = (memo) => Buffer.byteLength(memo, 'utf8') <= 28;

test('accepts a short memo under 28 UTF-8 bytes', () => {
  const memo = `${'é'.repeat(13)}a`;
  assert.equal(Buffer.byteLength(memo, 'utf8'), 27);
  assert.equal(isMemoLengthValid(memo), true);
});

test('rejects a memo above the byte limit', () => {
  assert.equal(isMemoLengthValid('a'.repeat(29)), false);
});
