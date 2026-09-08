const test = require('node:test');
const assert = require('node:assert/strict');
const { networkDisplayName } = require('../lib/network-display-name');
const { networkDisplayNameFixture } = require('./fixtures/network-display-name.fixture');

for (const { input, output } of networkDisplayNameFixture) {
  test(`networkDisplayName maps ${JSON.stringify(input)} to ${output}`, () => {
    assert.equal(networkDisplayName(input), output);
  });
}

test('networkDisplayName handles surrounding whitespace and casing', () => {
  assert.equal(networkDisplayName('  TESTNET  '), 'Testnet');
});
