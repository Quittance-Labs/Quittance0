const test = require('node:test');
const assert = require('node:assert/strict');
const { walletStorageKey, WALLET_STORAGE_KEYS } = require('../lib/wallet-storage-key');
const { walletStorageKeyFixture } = require('./fixtures/wallet-storage-key.fixture');

for (const { name, input, expected } of walletStorageKeyFixture) {
  test(`walletStorageKey ${name}`, () => {
    assert.equal(walletStorageKey(input), expected);
  });
}

test('WALLET_STORAGE_KEYS contains expected keys', () => {
  assert.equal(WALLET_STORAGE_KEYS.publicKey, 'quittance:wallet:publicKey');
  assert.equal(WALLET_STORAGE_KEYS.balance, 'quittance:wallet:balance');
  assert.equal(WALLET_STORAGE_KEYS.connected, 'quittance:wallet:connected');
  assert.equal(WALLET_STORAGE_KEYS.network, 'quittance:wallet:network');
});
