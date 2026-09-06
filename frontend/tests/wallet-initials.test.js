const test = require('node:test');
const assert = require('node:assert/strict');
const { initialsFromAddress } = require('../lib/wallet-initials.ts');
const { walletInitialsFixture } = require('./fixtures/wallet-initials.fixture.js');

for (const { input, expected } of walletInitialsFixture) {
  test(`initialsFromAddress handles ${JSON.stringify(input)} safely`, () => {
    assert.equal(initialsFromAddress(input), expected);
  });
}

test('initialsFromAddress handles non-string inputs safely', () => {
  assert.equal(initialsFromAddress(12345), '');
  assert.equal(initialsFromAddress(true), '');
  assert.equal(initialsFromAddress({}), '');
  assert.equal(initialsFromAddress([]), '');
});

test('initialsFromAddress strips non-alphanumeric characters', () => {
  assert.equal(initialsFromAddress('G-A-P-5'), 'GA');
  assert.equal(initialsFromAddress('!!g_b!!'), 'GB');
});
