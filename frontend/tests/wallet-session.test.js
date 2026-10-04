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
  walletSessionChanged,
  walletSessionGate,
  walletSessionKey,
  createSellerSessionManager,
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

  const mismatch = walletSessionGate(
    session({ network: 'PUBLIC', networkPassphrase: 'Public Global Stellar Network ; September 2015' }),
    'TESTNET'
  );
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

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function sessionHarness(authenticate) {
  let wallet = session();
  let now = 1_000_000;
  const manager = createSellerSessionManager({
    getWalletSession: () => wallet,
    expectedNetwork: 'TESTNET',
    now: () => now,
    authenticate,
  });
  manager.sync();
  return {
    manager,
    switchWallet(next) { wallet = session(next); manager.sync(); },
    advance(milliseconds) { now += milliseconds; },
  };
}

const issuedFor = (context, token = 'earned-token') => ({
  token, sellerPublicKey: context.publicKey, network: 'TESTNET', expiresAt: 4600,
});

test('dashboard list and stats share one sign-in and keep the token only in memory', async () => {
  let calls = 0;
  const { manager } = sessionHarness(async (context) => {
    calls += 1;
    return issuedFor(context);
  });
  const context = manager.contextFor(ALICE);
  assert.deepEqual(await Promise.all([manager.getToken(context), manager.getToken(context)]),
    ['earned-token', 'earned-token']);
  assert.equal(await manager.getToken(context), 'earned-token');
  assert.equal(calls, 1);
  assert.equal('token' in manager.sync(), false, 'the wallet shape never contains the token');
});

test('switching accounts synchronously drops the old token before the next fetch', async () => {
  const harness = sessionHarness(async (context) => issuedFor(context, context.publicKey));
  const alice = harness.manager.contextFor(ALICE);
  await harness.manager.getToken(alice);
  harness.switchWallet({ publicKey: BOB });
  assert.equal(harness.manager.isCurrent(alice), false);
  const bob = harness.manager.contextFor(BOB);
  assert.equal(harness.manager.cachedToken(bob), null);
  await assert.rejects(harness.manager.getToken(alice), { code: 'WALLET_SESSION_CHANGED' });
  assert.equal(await harness.manager.getToken(bob), BOB);
});

test('an A to B to A switch cannot publish an earlier challenge result', async () => {
  const result = deferred();
  const harness = sessionHarness(() => result.promise);
  const alice = harness.manager.contextFor(ALICE);
  const oldRequest = harness.manager.getToken(alice);
  await Promise.resolve();
  harness.switchWallet({ publicKey: BOB });
  harness.switchWallet({ publicKey: ALICE });
  result.resolve(issuedFor(alice));
  await assert.rejects(oldRequest, { code: 'WALLET_SESSION_CHANGED' });
  assert.equal(harness.manager.cachedToken(harness.manager.contextFor(ALICE)), null);
});

test('a passphrase change under the same network name drops authentication', async () => {
  const harness = sessionHarness(async (context) => issuedFor(context));
  const alice = harness.manager.contextFor(ALICE);
  await harness.manager.getToken(alice);
  harness.switchWallet({ networkPassphrase: 'untrusted custom network' });
  assert.equal(harness.manager.isCurrent(alice), false);
  assert.throws(() => harness.manager.contextFor(ALICE), { code: 'AUTH_WALLET_REQUIRED' });
  harness.switchWallet({});
  assert.equal(harness.manager.cachedToken(harness.manager.contextFor(ALICE)), null);
});

test('expired tokens reauthenticate and a late 401 cannot evict the refreshed token', async () => {
  let issued = 0;
  const harness = sessionHarness(async (context) => ({
    ...issuedFor(context, `token-${++issued}`), expiresAt: 1010 + issued * 10,
  }));
  const context = harness.manager.contextFor(ALICE);
  assert.equal(await harness.manager.getToken(context), 'token-1');
  harness.advance(20_000);
  assert.equal(await harness.manager.getToken(context), 'token-2');
  harness.manager.invalidate(context, 'token-1');
  assert.equal(harness.manager.cachedToken(context), 'token-2');
  assert.equal(issued, 2);
});

test('the server cannot cache a token for another wallet or network', async () => {
  for (const override of [{ sellerPublicKey: BOB }, { network: 'PUBLIC' }, { expiresAt: 999 }]) {
    const { manager } = sessionHarness(async (context) => ({ ...issuedFor(context), ...override }));
    const context = manager.contextFor(ALICE);
    await assert.rejects(manager.getToken(context), { code: 'AUTH_INVALID_SESSION' });
    assert.equal(manager.cachedToken(context), null);
  }
});
