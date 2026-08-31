const test = require('node:test');
const assert = require('node:assert/strict');
const { buildHorizonAccountUrl } = require('../lib/explorer-account-link');
const {
  explorerAccountLinkFixture,
  explorerAccountLinkErrorFixture,
} = require('./fixtures/explorer-account-link.fixture');

for (const { name, publicKey, network, expected } of explorerAccountLinkFixture) {
  test(`buildHorizonAccountUrl ${name}`, () => {
    assert.equal(buildHorizonAccountUrl(publicKey, network), expected);
  });
}

for (const { name, publicKey, network } of explorerAccountLinkErrorFixture) {
  test(`buildHorizonAccountUrl ${name}`, () => {
    assert.equal(buildHorizonAccountUrl(publicKey, network), null);
  });
}
