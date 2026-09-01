const test = require('node:test');
const assert = require('node:assert/strict');
const {
  FREIGHTER_INSTALL_URL,
  FREIGHTER_REQUIRED_MESSAGE,
  FREIGHTER_WRONG_NETWORK_MESSAGE,
  detectFreighter,
  isNetworkMatching,
} = require('../lib/freighter-availability');

test('detectFreighter reports an installed extension', async () => {
  assert.equal(await detectFreighter(async () => true), true);
});

test('detectFreighter reports a missing extension', async () => {
  assert.equal(await detectFreighter(async () => false), false);
});

test('detectFreighter treats extension API failures as missing', async () => {
  assert.equal(
    await detectFreighter(async () => {
      throw new Error('Freighter API unavailable');
    }),
    false
  );
});

test('the install prompt links to the official Freighter site', () => {
  assert.equal(FREIGHTER_INSTALL_URL, 'https://www.freighter.app/');
  assert.match(FREIGHTER_REQUIRED_MESSAGE, /browser extension/);
  assert.match(FREIGHTER_REQUIRED_MESSAGE, /create or pay an invoice/);
});

test('FREIGHTER_WRONG_NETWORK_MESSAGE formats target network', () => {
  assert.match(FREIGHTER_WRONG_NETWORK_MESSAGE('Testnet'), /switch to Testnet in Freighter/);
  assert.match(FREIGHTER_WRONG_NETWORK_MESSAGE('Public'), /switch to Public in Freighter/);
});

test('isNetworkMatching correctly compares network names and passphrases', () => {
  assert.equal(isNetworkMatching('TESTNET', 'TESTNET'), true);
  assert.equal(isNetworkMatching('testnet', 'TESTNET'), true);
  assert.equal(isNetworkMatching('Test SDF Network ; September 2015', 'TESTNET'), true);
  assert.equal(isNetworkMatching('Public Global Stellar Network ; September 2015', 'PUBLIC'), true);
  assert.equal(isNetworkMatching('PUBLIC', 'TESTNET'), false);
  assert.equal(isNetworkMatching(null, 'TESTNET'), false);
  assert.equal(isNetworkMatching(undefined, 'TESTNET'), false);
});
