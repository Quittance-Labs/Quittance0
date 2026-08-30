const test = require('node:test');
const assert = require('node:assert/strict');

const sortAssetCodesAlpha = (codes) => [...codes].sort((a, b) => a.localeCompare(b));

test('sorts asset codes alphabetically', () => {
  assert.deepEqual(sortAssetCodesAlpha(['USDC', 'BTC', 'ETH']), ['BTC', 'ETH', 'USDC']);
});

test('keeps an empty asset code list empty', () => {
  assert.deepEqual(sortAssetCodesAlpha([]), []);
});
