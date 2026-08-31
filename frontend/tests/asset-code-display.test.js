const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeAssetCode } = require('../lib/asset-code-display');
const { assetCodeDisplayFixture } = require('./fixtures/asset-code-display.fixture');

for (const { name, input, expected } of assetCodeDisplayFixture) {
  test(`normalizeAssetCode ${name}`, () => {
    assert.equal(normalizeAssetCode(input), expected);
  });
}
