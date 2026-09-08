const test = require('node:test');
const assert = require('node:assert/strict');
const {
  FREIGHTER_INSTALL_URL,
  FREIGHTER_CONNECT_REQUIRED_MESSAGE,
  FREIGHTER_REQUIRED_MESSAGE,
  detectFreighter,
  networkLabel,
  networkMatches,
  normalizeFreighterBoolean,
  normalizeNetworkName,
  walletGate,
  wrongNetworkMessage,
} = require('../lib/freighter-availability');

test('detectFreighter reports an installed extension', async () => {
  assert.equal(await detectFreighter(async () => true), true);
  assert.equal(await detectFreighter(async () => ({ isConnected: true })), true);
});

test('detectFreighter reports a missing extension', async () => {
  assert.equal(await detectFreighter(async () => false), false);
  assert.equal(await detectFreighter(async () => ({ isConnected: false })), false);
  assert.equal(await detectFreighter(async () => ({ error: 'not found' })), false);
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

test('normalizes Freighter boolean responses across API versions', () => {
  assert.equal(normalizeFreighterBoolean(true, 'isAllowed'), true);
  assert.equal(normalizeFreighterBoolean({ isAllowed: true }, 'isAllowed'), true);
  assert.equal(normalizeFreighterBoolean({ isAllowed: false }, 'isAllowed'), false);
  assert.equal(normalizeFreighterBoolean({ error: 'denied', isAllowed: true }, 'isAllowed'), false);
});

test('normalizes and labels Freighter networks', () => {
  assert.equal(normalizeNetworkName(' pubnet '), 'PUBLIC');
  assert.equal(networkLabel('TESTNET'), 'Testnet');
  assert.equal(networkLabel('PUBLIC'), 'Mainnet');
  assert.equal(networkLabel(null), 'Unknown network');
  assert.equal(networkMatches('PUBNET', 'PUBLIC'), true);
  assert.equal(networkMatches('TESTNET', 'PUBLIC'), false);
});

test('walletGate blocks the missing extension state', () => {
  assert.deepEqual(walletGate({ freighterAvailable: false }, 'TESTNET'), {
    status: 'missing',
    ready: false,
    title: 'Install Freighter',
    message: FREIGHTER_REQUIRED_MESSAGE,
    action: 'install',
  });
});

test('walletGate blocks disconnected wallets with shared copy', () => {
  const gate = walletGate({ freighterAvailable: true, connected: false }, 'TESTNET');

  assert.equal(gate.status, 'disconnected');
  assert.equal(gate.ready, false);
  assert.equal(gate.message, FREIGHTER_CONNECT_REQUIRED_MESSAGE);
});

test('walletGate blocks a connected wallet on the wrong network', () => {
  const gate = walletGate({
    freighterAvailable: true,
    connected: true,
    publicKey: 'G'.padEnd(56, 'A'),
    network: 'PUBLIC',
  }, 'TESTNET');

  assert.equal(gate.status, 'wrong_network');
  assert.equal(gate.ready, false);
  assert.equal(gate.message, wrongNetworkMessage('TESTNET', 'PUBLIC'));
});

test('walletGate allows a connected wallet on the expected network', () => {
  const gate = walletGate({
    freighterAvailable: true,
    connected: true,
    publicKey: 'G'.padEnd(56, 'A'),
    network: 'TESTNET',
  }, 'TESTNET');

  assert.equal(gate.status, 'ready');
  assert.equal(gate.ready, true);
});
