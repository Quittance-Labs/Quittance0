const test = require('node:test');
const assert = require('node:assert/strict');
const { walletStorageKey } = require('../lib/wallet-storage-key.ts');
const { walletStorageKeyFixture } = require('./fixtures/wallet-storage-key.fixture.js');

for (const { input, output } of walletStorageKeyFixture) {
  test(`walletStorageKey produces "${output}" for ${JSON.stringify(input)}`, () => {
    assert.equal(walletStorageKey(input), output);
  });
}

test('walletStorageKey handles non-string inputs safely', () => {
  assert.equal(walletStorageKey(123), 'wallet-storage');
  assert.equal(walletStorageKey(true), 'wallet-storage');
  assert.equal(walletStorageKey({}), 'wallet-storage');
  assert.equal(walletStorageKey([]), 'wallet-storage');
});
