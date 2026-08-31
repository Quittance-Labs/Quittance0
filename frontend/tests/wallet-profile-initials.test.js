const test = require('node:test');
const assert = require('node:assert/strict');
const { walletProfileInitials } = require('../lib/wallet-profile-initials');
const { walletProfileInitialsFixture, walletProfileInitialsErrorFixture } = require('./fixtures/wallet-profile-initials.fixture');

for (const { name, publicKey, expected } of walletProfileInitialsFixture) {
  test(`walletProfileInitials ${name}`, () => {
    assert.equal(walletProfileInitials(publicKey), expected);
  });
}

for (const { name, publicKey } of walletProfileInitialsErrorFixture) {
  test(`walletProfileInitials ${name}`, () => {
    assert.equal(walletProfileInitials(publicKey), '??');
  });
}
