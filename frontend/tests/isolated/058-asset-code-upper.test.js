const test = require('node:test');
const assert = require('node:assert/strict');

function normalizeAssetCode(code) {
  if (code === null || code === undefined) {
    return '';
  }
  if (typeof code !== 'string') {
    return '';
  }
  return code.trim().toUpperCase();
}

test('normalizes lowercase and mixedcase asset codes to uppercase', () => {
  assert.equal(normalizeAssetCode('xlm'), 'XLM');
  assert.equal(normalizeAssetCode('Usdc'), 'USDC');
  assert.equal(normalizeAssetCode('  xlm  '), 'XLM');
  assert.equal(normalizeAssetCode('XLM'), 'XLM');
});

test('handles non-string inputs, empty strings, and null/undefined values safely', () => {
  assert.equal(normalizeAssetCode(''), '');
  assert.equal(normalizeAssetCode('   '), '');
  assert.equal(normalizeAssetCode(null), '');
  assert.equal(normalizeAssetCode(undefined), '');
  assert.equal(normalizeAssetCode(123), '');
});
