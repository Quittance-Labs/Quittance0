const test = require('node:test');
const assert = require('node:assert/strict');

function networkLabel(network) {
  return network === 'TESTNET' ? 'Testnet' : 'Mainnet';
}

test('maps TESTNET to the Testnet label', () => {
  assert.equal(networkLabel('TESTNET'), 'Testnet');
});

test('uses the Mainnet label for a non-TESTNET value', () => {
  assert.equal(networkLabel('PUBLIC'), 'Mainnet');
});
