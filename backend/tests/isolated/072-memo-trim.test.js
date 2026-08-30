const test = require('node:test');
const assert = require('node:assert/strict');

const trimMemo = (memo) => memo.trim();

test('trims surrounding memo whitespace', () => {
  assert.equal(trimMemo('  payment note  '), 'payment note');
});

test('trims a whitespace-only memo to empty', () => {
  assert.equal(trimMemo('   '), '');
});
