const test = require('node:test');
const assert = require('node:assert/strict');

function withDefaultAssetCode(assetCode) {
  return assetCode === undefined ? 'XLM' : assetCode;
}

test('defaults a missing asset code to XLM', () => {
  assert.equal(withDefaultAssetCode(), 'XLM');
});

test('preserves an explicitly selected asset code', () => {
  assert.equal(withDefaultAssetCode('USDC'), 'USDC');
});
