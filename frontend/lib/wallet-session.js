/**
 * One wallet session, one shape (issue #442).
 *
 * Wallet state reached the UI as four loose store fields that each surface
 * interpreted for itself: the pay page, the invoice page, the dashboard, the
 * payment button and the create form all read publicKey/connected/network and
 * decided separately whether the wallet could act, whether a network mismatch
 * blocked them, and whether the rows on screen still belonged to the connected
 * account. The answers drifted, and the drift is what "stale public key" bugs
 * are made of.
 *
 * This module has no React, store or Freighter dependency. The normaliser and
 * in-memory seller session manager share the same walletGate decision.
 */

const { walletGate } = require('./freighter-availability');

/**
 * The session the rest of the app consumes.
 *
 * @typedef {object} WalletSession
 * @property {string|null} publicKey Normalised, or null when not connected.
 * @property {string|null} network Upper-cased network name, or null.
 * @property {string|null} networkPassphrase Raw passphrase when known.
 * @property {string} balance Display balance, '0' when unknown.
 * @property {boolean} connected True only with a public key present.
 * @property {boolean|undefined} freighterAvailable undefined when unchecked.
 * @property {string|null} lastError Last connection error, when there was one.
 */

function trimmedOrNull(value) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

/**
 * Normalise anything that looks like a wallet session.
 *
 * A session whose public key is missing is not connected, whatever the store
 * says: that pair disagreeing is how a stale key survives a disconnect.
 *
 * @param {object} [source]
 * @returns {WalletSession}
 */
function normalizeWalletSession(source) {
  // A null session is a real input - the store hands one over before the first
  // connect - so it is normalised to the empty session rather than crashing.
  const input = source && typeof source === 'object' ? source : {};
  const publicKey = trimmedOrNull(input.publicKey);
  const network = trimmedOrNull(input.network);

  return {
    publicKey,
    network: network ? network.toUpperCase() : null,
    networkPassphrase: trimmedOrNull(input.networkPassphrase),
    balance: trimmedOrNull(input.balance) || '0',
    connected: Boolean(input.connected && publicKey),
    freighterAvailable:
      input.freighterAvailable === true
        ? true
        : input.freighterAvailable === false
          ? false
          : undefined,
    lastError: trimmedOrNull(input.lastError),
  };
}

/**
 * Whether the session may proceed on the expected network.
 *
 * Delegates to walletGate, so the banner, the toast and the disabled submit
 * button cannot disagree about why a wallet cannot act.
 *
 * @param {object} [session]
 * @param {string} expectedNetwork
 */
function walletSessionGate(session, expectedNetwork) {
  return walletGate(normalizeWalletSession(session), expectedNetwork);
}

/**
 * A stable key for anything cached against this session.
 *
 * Null when there is no account, so a caller can use it as "nothing is
 * loaded" rather than inventing its own sentinel.
 *
 * @param {object} [session]
 * @returns {string|null}
 */
function walletSessionKey(session) {
  const normalized = normalizeWalletSession(session);
  if (!normalized.publicKey) return null;
  return normalized.publicKey + '@' + (normalized.network || 'unknown');
}

/**
 * What changed between two sessions.
 *
 * Account and network are reported separately because they invalidate
 * different things: a network switch makes an on-chain action unsafe, while an
 * account switch makes another seller's rows wrong to display.
 *
 * @param {object} [previous]
 * @param {object} [next]
 */
function walletSessionChanged(previous, next) {
  const before = normalizeWalletSession(previous);
  const after = normalizeWalletSession(next);

  const accountChanged = before.publicKey !== after.publicKey;
  const networkChanged = before.network !== after.network ||
    before.networkPassphrase !== after.networkPassphrase;
  const connectionChanged = before.connected !== after.connected;

  return {
    changed: accountChanged || networkChanged || connectionChanged,
    accountChanged,
    networkChanged,
    connectionChanged,
  };
}

/**
 * Whether seller-scoped rows and counts must be dropped before the next fetch.
 *
 * True whenever the rows on screen belong to a different account than the
 * session about to load, including the first connect, where nothing may be
 * assumed to belong to the new key yet. A network switch alone does not make
 * the previous seller's invoices wrong to display, so it does not clear them.
 *
 * @param {object} [previous]
 * @param {object} [next]
 */
function shouldClearSellerState(previous, next) {
  const after = normalizeWalletSession(next);
  if (!after.publicKey) return true;
  return normalizeWalletSession(previous).publicKey !== after.publicKey;
}

function sessionError(code, message, status = 401) {
  return Object.assign(new Error(message), {
    code, status, response: { status, data: { success: false, code, error: message } },
  });
}

/**
 * A bearer token belongs to one uninterrupted wallet session, not merely a
 * public key. Epochs also fence A -> B -> A switches while Freighter is open.
 * Nothing in this manager is written to localStorage or the persisted store.
 *
 * `sync` must be subscribed synchronously to wallet changes. Each operation
 * also reads the wallet itself, so a delayed React effect cannot reuse a token.
 * `authenticate` checks assertCurrent between its challenge/sign/redeem awaits.
 */
function createSellerSessionManager({ getWalletSession, authenticate, expectedNetwork, now = Date.now }) {
  let scope;
  let generation = 0;
  let token = null;
  let pending = null;

  function sync() {
    const wallet = normalizeWalletSession(getWalletSession());
    const nextScope = JSON.stringify([
      wallet.publicKey, wallet.connected, wallet.network,
      wallet.networkPassphrase, wallet.freighterAvailable === false,
    ]);
    if (nextScope !== scope) {
      scope = nextScope;
      generation += 1;
      token = null;
      pending = null;
    }
    return wallet;
  }

  function contextFor(expectedPublicKey) {
    const wallet = sync();
    const gate = walletSessionGate(wallet, expectedNetwork);
    if (!gate.ready) throw sessionError('AUTH_WALLET_REQUIRED', gate.message);
    if (expectedPublicKey && expectedPublicKey !== wallet.publicKey) {
      throw sessionError('WALLET_SESSION_CHANGED', 'The connected wallet changed. Please try again.', 409);
    }
    return Object.freeze({ ...wallet, generation, network: expectedNetwork });
  }

  function isCurrent(context) {
    const wallet = sync();
    return Boolean(context && context.generation === generation &&
      context.publicKey === wallet.publicKey && walletSessionGate(wallet, expectedNetwork).ready);
  }

  function assertCurrent(context) {
    if (!isCurrent(context)) {
      throw sessionError('WALLET_SESSION_CHANGED', 'The connected wallet changed. Please try again.', 409);
    }
  }

  function cachedToken(context) {
    assertCurrent(context);
    if (token && token.expiresAt * 1000 <= now()) token = null;
    return token ? token.token : null;
  }

  async function getToken(context) {
    const cached = cachedToken(context);
    if (cached) return cached;
    if (pending) return pending;

    const request = Promise.resolve().then(async () => {
      assertCurrent(context);
      const issued = await authenticate(context, () => assertCurrent(context));
      assertCurrent(context);
      if (!issued || typeof issued.token !== 'string' || !issued.token ||
          issued.sellerPublicKey !== context.publicKey || issued.network !== expectedNetwork ||
          !Number.isSafeInteger(issued.expiresAt) || issued.expiresAt * 1000 <= now()) {
        throw sessionError('AUTH_INVALID_SESSION', 'The server returned an invalid seller session.');
      }
      token = { token: issued.token, expiresAt: issued.expiresAt };
      return token.token;
    });
    pending = request;
    try {
      return await request;
    } finally {
      // A stale challenge must never clear the new wallet's pending login.
      if (pending === request) pending = null;
    }
  }

  function invalidate(context, rejectedToken) {
    assertCurrent(context);
    // A late 401 for the previous token must not evict a successful refresh.
    if (token && token.token === rejectedToken) token = null;
  }

  function clear() {
    generation += 1;
    token = null;
    pending = null;
  }

  return { sync, contextFor, isCurrent, assertCurrent, getToken, cachedToken, invalidate, clear };
}

module.exports = {
  createSellerSessionManager,
  normalizeWalletSession,
  shouldClearSellerState,
  walletSessionChanged,
  walletSessionGate,
  walletSessionKey,
};
