const test = require('node:test');
const assert = require('node:assert/strict');
const { buildHorizonTxUrl } = require('../lib/explorer-tx-link');
const {
  explorerTxLinkFixture,
  explorerTxLinkErrorFixture,
} = require('./fixtures/explorer-tx-link.fixture');

for (const { name, txHash, network, expected } of explorerTxLinkFixture) {
  test(`buildHorizonTxUrl ${name}`, () => {
    assert.equal(buildHorizonTxUrl(txHash, network), expected);
  });
}

for (const { name, txHash, network } of explorerTxLinkErrorFixture) {
  test(`buildHorizonTxUrl ${name}`, () => {
    assert.equal(buildHorizonTxUrl(txHash, network), null);
  });
}
