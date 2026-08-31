const test = require('node:test');
const assert = require('node:assert/strict');
const { initialsFromAddress } = require('../lib/wallet-initials.ts');
const {
  walletInitialsFixture,
  walletInitialsErrorFixture,
} = require('./fixtures/wallet-initials.fixture');

for (const { name, publicKey, expected } of walletInitialsFixture) {
  test(`initialsFromAddress ${name}`, () => {
    assert.equal(initialsFromAddress(publicKey), expected);
  });
}

for (const { name, publicKey } of walletInitialsErrorFixture) {
  test(`initialsFromAddress ${name}`, () => {
    assert.equal(initialsFromAddress(publicKey), '??');
  });
}
