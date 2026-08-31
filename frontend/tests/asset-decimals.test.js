const test = require('node:test');
const assert = require('node:assert/strict');
const {
  decimalsForAsset,
  DEFAULT_DECIMALS,
} = require('../lib/asset-decimals.ts');
const { assetDecimalsFixture } = require('./fixtures/asset-decimals.fixture');

for (const { name, assetCode, expected } of assetDecimalsFixture) {
  test(`decimalsForAsset ${name}`, () => {
    assert.equal(decimalsForAsset(assetCode), expected);
  });
}

test('DEFAULT_DECIMALS is 7', () => {
  assert.equal(DEFAULT_DECIMALS, 7);
});
