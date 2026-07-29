const test = require('node:test');
const assert = require('node:assert/strict');

const networkLabel = (network) =>
  network === 'TESTNET' ? 'Testnet' : 'Mainnet';

test('maps PUBLIC to the Mainnet label', () => {
  assert.equal(networkLabel('PUBLIC'), 'Mainnet');
});

test('uses the Testnet label for TESTNET', () => {
  assert.equal(networkLabel('TESTNET'), 'Testnet');
});
