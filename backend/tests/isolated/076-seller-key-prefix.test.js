const test = require('node:test');
const assert = require('node:assert/strict');

function startsWithG(publicKey) {
  return publicKey.startsWith('G');
}

test('accepts a seller public key that starts with G', () => {
  assert.equal(startsWithG('GABC123'), true);
});

test('rejects seller public keys without the G prefix', () => {
  assert.equal(startsWithG('SABC123'), false);
  assert.equal(startsWithG(''), false);
});
