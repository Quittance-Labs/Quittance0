/**
 * Issue #442 - one session shape for every surface.
 *
 * The cases are the ones that used to be answered differently in five places:
 * a store that says connected with no public key, an account switch that left
 * the previous seller's rows on screen, a network switch that must block an
 * on-chain action without clearing history, and an unchecked extension that
 * must not be reported as missing.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeWalletSession,
  shouldClearSellerState,
  shouldResetPaySession,
  walletSessionChanged,
  walletSessionGate,
  walletSessionKey,
} = require('../lib/wallet-session');

const ALICE = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';
const BOB = 'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H';

const session = (overrides = {}) => ({
  publicKey: ALICE,
  network: 'TESTNET',
  networkPassphrase: 'Test SDF Network ; September 2015',
  balance: '12.50',
  connected: true,
  freighterAvailable: true,
  ...overrides,
});

test('a session is normalised into one shape', () => {
  assert.deepEqual(normalizeWalletSession(session({ publicKey: '  ' + ALICE + '  ' })), {
    publicKey: ALICE,
    network: 'TESTNET',
    networkPassphrase: 'Test SDF Network ; September 2015',
    balance: '12.50',
    connected: true,
    freighterAvailable: true,
    lastError: null,
  });

  assert.deepEqual(normalizeWalletSession(), {
    publicKey: null,
    network: null,
    networkPassphrase: null,
    balance: '0',
    connected: false,
    freighterAvailable: undefined,
    lastError: null,
  });
});

test('connected without a public key is not connected', () => {
  const normalized = normalizeWalletSession(session({ publicKey: null }));

  assert.equal(normalized.publicKey, null);
  assert.equal(normalized.connected, false);
  assert.equal(walletSessionKey(normalized), null);
});

test('the network is upper-cased and the balance never renders empty', () => {
  const normalized = normalizeWalletSession(
    session({ network: 'testnet', balance: '', networkPassphrase: '   ' })
  );

  assert.equal(normalized.network, 'TESTNET');
  assert.equal(normalized.balance, '0');
  assert.equal(normalized.networkPassphrase, null);
});

test('an unchecked extension stays unchecked instead of reading as missing', () => {
  assert.equal(normalizeWalletSession(session({ freighterAvailable: undefined })).freighterAvailable, undefined);
  assert.equal(normalizeWalletSession(session({ freighterAvailable: false })).freighterAvailable, false);
  assert.equal(normalizeWalletSession(session({ freighterAvailable: true })).freighterAvailable, true);
});

test('the session gate is the gate every surface already uses', () => {
  assert.equal(walletSessionGate(session(), 'TESTNET').status, 'ready');
  assert.equal(walletSessionGate(session(), 'TESTNET').ready, true);

  const missing = walletSessionGate(session({ freighterAvailable: false }), 'TESTNET');
  assert.equal(missing.status, 'missing');
  assert.equal(missing.action, 'install');

  const idle = walletSessionGate(session({ connected: false, publicKey: null }), 'TESTNET');
  assert.equal(idle.status, 'disconnected');

  const mismatch = walletSessionGate(session({ network: 'PUBLIC' }), 'TESTNET');
  assert.equal(mismatch.status, 'wrong_network');
  assert.equal(mismatch.ready, false);
});

test('the cache key names the account and the network it belongs to', () => {
  assert.equal(walletSessionKey(session()), ALICE + '@TESTNET');
  assert.equal(walletSessionKey(session({ network: 'public' })), ALICE + '@PUBLIC');
  assert.equal(walletSessionKey(session({ network: null })), ALICE + '@unknown');
  assert.equal(walletSessionKey({ publicKey: null }), null);
});

test('an account switch is reported apart from a network switch', () => {
  const switched = walletSessionChanged(session(), session({ publicKey: BOB }));
  assert.equal(switched.changed, true);
  assert.equal(switched.accountChanged, true);
  assert.equal(switched.networkChanged, false);

  const moved = walletSessionChanged(session(), session({ network: 'PUBLIC' }));
  assert.equal(moved.changed, true);
  assert.equal(moved.accountChanged, false);
  assert.equal(moved.networkChanged, true);

  const same = walletSessionChanged(session(), session({ balance: '99.00' }));
  assert.equal(same.changed, false);
  assert.equal(same.connectionChanged, false);
});

test('seller rows are dropped on an account switch, not on a network switch', () => {
  assert.equal(shouldClearSellerState(session(), session({ publicKey: BOB })), true);
  assert.equal(shouldClearSellerState(session(), session({ connected: false, publicKey: null })), true);
  assert.equal(shouldClearSellerState(session(), session({ network: 'PUBLIC' })), false);
  assert.equal(shouldClearSellerState(session(), session({ balance: '0' })), false);
  // A key appearing where there was none is still a change of owner: nothing
  // on screen may be assumed to belong to it.
  assert.equal(shouldClearSellerState(null, session()), true);
});

test('a session that has not been read yet clears rather than caches', () => {
  assert.equal(shouldClearSellerState(session(), null), true);
  assert.equal(shouldClearSellerState(session(), {}), true);
});

test('pay session resets on account switch or disconnect, but preserves on network change', () => {
  assert.equal(shouldResetPaySession(session(), session({ publicKey: BOB })), true);
  assert.equal(shouldResetPaySession(session(), session({ connected: false, publicKey: null })), true);
  assert.equal(shouldResetPaySession(null, session()), true);
  assert.equal(shouldResetPaySession(session(), session({ network: 'PUBLIC' })), false);
  assert.equal(shouldResetPaySession(session(), session({ balance: '500.00' })), false);
  assert.equal(shouldResetPaySession(null, null), false);
});
