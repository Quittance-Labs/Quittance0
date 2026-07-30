const test = require('node:test');
const assert = require('node:assert/strict');

const startsWithG = (address) => address.startsWith('G');

test('accepts a Stellar address starting with G', () => {
  assert.equal(startsWithG('GABCDEFGHIJKLMNOPQRSTUVWXYZ234567'), true);
});

test('rejects addresses without the G prefix', () => {
  assert.equal(startsWithG('CABCDEFGHIJKLMNOPQRSTUVWXYZ234567'), false);
  assert.equal(startsWithG(''), false);
});
