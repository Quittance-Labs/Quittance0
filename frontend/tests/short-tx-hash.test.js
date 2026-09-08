const test = require('node:test');
const assert = require('node:assert/strict');
const { shortenTxHash } = require('../lib/short-tx-hash.ts');
const {
  shortTxHashFixture,
  shortTxHashErrorFixture,
} = require('./fixtures/short-tx-hash.fixture');

for (const { name, hash, head, tail, expected } of shortTxHashFixture) {
  test(`shortenTxHash ${name}`, () => {
    assert.equal(shortenTxHash(hash, head, tail), expected);
  });
}

for (const { name, hash, head, tail } of shortTxHashErrorFixture) {
  test(`shortenTxHash ${name}`, () => {
    assert.equal(shortenTxHash(hash, head, tail), null);
  });
}
