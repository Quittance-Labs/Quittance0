const test = require('node:test');
const assert = require('node:assert/strict');
const { buildHorizonAccountUrl } = require('../lib/explorer-account-link');
const {
  validPublicKey,
  testnetNetwork,
  publicNetwork,
  expectedTestnetUrl,
  expectedPublicUrl,
} = require('./fixtures/explorer-account-link.fixture');

test('buildHorizonAccountUrl returns testnet explorer URL', () => {
  assert.equal(buildHorizonAccountUrl(validPublicKey, testnetNetwork), expectedTestnetUrl);
});

test('buildHorizonAccountUrl returns public explorer URL', () => {
  assert.equal(buildHorizonAccountUrl(validPublicKey, publicNetwork), expectedPublicUrl);
});

test('buildHorizonAccountUrl normalizes network casing', () => {
  assert.equal(buildHorizonAccountUrl(validPublicKey, 'testnet'), expectedTestnetUrl);
  assert.equal(buildHorizonAccountUrl(validPublicKey, 'public'), expectedPublicUrl);
});

test('buildHorizonAccountUrl trims whitespace from publicKey and network', () => {
  assert.equal(
    buildHorizonAccountUrl(`  ${validPublicKey}  `, `  ${testnetNetwork}  `),
    expectedTestnetUrl
  );
});

test('buildHorizonAccountUrl defaults unknown networks to public', () => {
  assert.equal(buildHorizonAccountUrl(validPublicKey, 'FUTURENET'), expectedPublicUrl);
});

test('buildHorizonAccountUrl throws when publicKey is empty', () => {
  assert.throws(() => buildHorizonAccountUrl('', testnetNetwork), /publicKey is required/);
  assert.throws(() => buildHorizonAccountUrl('   ', testnetNetwork), /publicKey is required/);
});
