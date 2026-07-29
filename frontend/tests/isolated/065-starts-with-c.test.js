const test = require('node:test');
const assert = require('node:assert/strict');

const startsWithC = (contractId) => contractId.startsWith('C');

test('accepts a contract id starting with C', () => {
  assert.equal(startsWithC('CABCDEFGHIJKLMNOPQRSTUVWXYZ234567'), true);
});

test('rejects values without the C prefix', () => {
  assert.equal(startsWithC('GABCDEFGHIJKLMNOPQRSTUVWXYZ234567'), false);
  assert.equal(startsWithC(''), false);
});
