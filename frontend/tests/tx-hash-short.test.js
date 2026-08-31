const test = require('node:test');
const assert = require('node:assert/strict');
const { formatShortTxHash } = require('../lib/tx-hash-short');
const { txHashShortFixture, txHashShortErrorFixture } = require('./fixtures/tx-hash-short.fixture');

for (const { name, txHash, head, tail, expected } of txHashShortFixture) {
  test(`formatShortTxHash ${name}`, () => {
    assert.equal(formatShortTxHash(txHash, head, tail), expected);
  });
}

for (const { name, txHash, head, tail } of txHashShortErrorFixture) {
  test(`formatShortTxHash ${name}`, () => {
    assert.equal(formatShortTxHash(txHash, head, tail), null);
  });
}
