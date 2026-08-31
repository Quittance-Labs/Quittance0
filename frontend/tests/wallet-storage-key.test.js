const test = require('node:test');
const assert = require('node:assert/strict');
const { walletStorageKey } = require('../lib/wallet-storage-key.ts');
const { walletStorageKeyFixture } = require('./fixtures/wallet-storage-key.fixture');

for (const { name, input, expected } of walletStorageKeyFixture) {
  test(`walletStorageKey ${name}`, () => {
    assert.equal(walletStorageKey(input), expected);
  });
}
