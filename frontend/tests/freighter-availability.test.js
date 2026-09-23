const test = require('node:test');
const assert = require('node:assert/strict');
const {
  FREIGHTER_INSTALL_URL,
  FREIGHTER_CONNECT_REQUIRED_MESSAGE,
  FREIGHTER_REQUIRED_MESSAGE,
  FREIGHTER_WRONG_NETWORK_MESSAGE,
  detectFreighter,
  isNetworkMatching,
  sessionNetworkMatches,
  TESTNET_PASSPHRASE,
  PUBLIC_PASSPHRASE,
  walletGate,
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

const SELLER_KEY = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';

test('walletGate asks for the extension when Freighter is not installed', () => {
  const gate = walletGate(
    { freighterAvailable: false, connected: false, publicKey: null, network: null },
    'TESTNET'
  );

  assert.equal(gate.status, 'missing');
  assert.equal(gate.ready, false);
  assert.equal(gate.action, 'install');
  assert.equal(gate.message, FREIGHTER_REQUIRED_MESSAGE);
});

test('walletGate asks the user to connect when the extension is installed but idle', () => {
  const gate = walletGate(
    { freighterAvailable: true, connected: false, publicKey: null, network: 'TESTNET' },
    'TESTNET'
  );

  assert.equal(gate.status, 'disconnected');
  assert.equal(gate.action, 'connect');
  assert.equal(gate.message, FREIGHTER_CONNECT_REQUIRED_MESSAGE);
});

test('walletGate blocks a connected wallet on the other network and names both', () => {
  const gate = walletGate(
    { freighterAvailable: true, connected: true, publicKey: SELLER_KEY, network: 'PUBLIC' },
    'TESTNET'
  );

  assert.equal(gate.status, 'wrong_network');
  assert.equal(gate.ready, false);
  assert.equal(gate.action, 'switch_network');
  assert.match(gate.message, /Testnet/);
  assert.match(gate.message, /Mainnet/);
});

test('walletGate treats an unreported network as a mismatch, not a pass', () => {
  const gate = walletGate(
    { freighterAvailable: true, connected: true, publicKey: SELLER_KEY, network: null },
    'TESTNET'
  );

  assert.equal(gate.ready, false);
  assert.equal(gate.status, 'wrong_network');
});

test('walletGate is ready on the expected network', () => {
  const gate = walletGate(
    { freighterAvailable: true, connected: true, publicKey: SELLER_KEY, network: 'TESTNET' },
    'TESTNET'
  );

  assert.equal(gate.status, 'ready');
  assert.equal(gate.ready, true);
  assert.equal(gate.action, 'none');
  assert.match(gate.message, /correct Stellar network/);
});

test('walletGate tolerates a missing session', () => {
  assert.equal(walletGate(undefined, 'TESTNET').status, 'disconnected');
});

test('sessionNetworkMatches verifies passphrase and falls back to network name', () => {
  assert.equal(
    sessionNetworkMatches({ networkPassphrase: TESTNET_PASSPHRASE, network: 'TESTNET' }, 'TESTNET'),
    true
  );
  assert.equal(
    sessionNetworkMatches({ networkPassphrase: PUBLIC_PASSPHRASE, network: 'PUBLIC' }, 'PUBLIC'),
    true
  );
  // Cryptographic passphrase mismatch overrides misleading network name
  assert.equal(
    sessionNetworkMatches({ networkPassphrase: PUBLIC_PASSPHRASE, network: 'TESTNET' }, 'TESTNET'),
    false
  );
  assert.equal(
    sessionNetworkMatches({ networkPassphrase: TESTNET_PASSPHRASE, network: 'PUBLIC' }, 'PUBLIC'),
    false
  );
  // When passphrase is absent, falls back to network name
  assert.equal(
    sessionNetworkMatches({ networkPassphrase: null, network: 'TESTNET' }, 'TESTNET'),
    true
  );
  assert.equal(
    sessionNetworkMatches({ networkPassphrase: null, network: 'PUBLIC' }, 'TESTNET'),
    false
  );
});

test('walletGate blocks when networkPassphrase does not match expected network', () => {
  const gate = walletGate(
    {
      freighterAvailable: true,
      connected: true,
      publicKey: SELLER_KEY,
      network: 'TESTNET',
      networkPassphrase: PUBLIC_PASSPHRASE,
    },
    'TESTNET'
  );

  assert.equal(gate.status, 'wrong_network');
  assert.equal(gate.ready, false);
  assert.equal(gate.action, 'switch_network');
});

test('walletGate allows when networkPassphrase matches expected network', () => {
  const gate = walletGate(
    {
      freighterAvailable: true,
      connected: true,
      publicKey: SELLER_KEY,
      network: 'TESTNET',
      networkPassphrase: TESTNET_PASSPHRASE,
    },
    'TESTNET'
  );

  assert.equal(gate.status, 'ready');
  assert.equal(gate.ready, true);
  assert.equal(gate.action, 'none');
});