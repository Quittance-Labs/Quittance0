const test = require('node:test');
const assert = require('node:assert/strict');
const { decimalsForAsset } = require('../lib/asset-decimals.ts');
const { assetDecimalsFixture } = require('./fixtures/asset-decimals.fixture.js');

for (const { input, expected } of assetDecimalsFixture) {
  test(`decimalsForAsset returns ${expected} for ${JSON.stringify(input)}`, () => {
    assert.equal(decimalsForAsset(input), expected);
  });
}

test('decimalsForAsset handles non-string inputs safely', () => {
  assert.equal(decimalsForAsset(123), 7);
  assert.equal(decimalsForAsset(true), 7);
  assert.equal(decimalsForAsset({}), 7);
  assert.equal(decimalsForAsset([]), 7);
});
