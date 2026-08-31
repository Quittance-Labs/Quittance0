const test = require('node:test');
const assert = require('node:assert/strict');
const { assetDecimalLookup, DEFAULT_DECIMALS } = require('../lib/asset-decimal-lookup');
const { assetDecimalLookupFixture } = require('./fixtures/asset-decimal-lookup.fixture');

for (const { name, assetCode, expected } of assetDecimalLookupFixture) {
  test(`assetDecimalLookup ${name}`, () => {
    assert.equal(assetDecimalLookup(assetCode), expected);
  });
}

test('DEFAULT_DECIMALS is 7', () => {
  assert.equal(DEFAULT_DECIMALS, 7);
});
