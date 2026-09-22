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
 * This module is the single normaliser. It is pure - no React, no store, no
 * Freighter call - so every surface can be tested against the same session
 * values, and it delegates the "can this wallet act?" decision to walletGate
 * rather than re-deriving it.
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
  const networkChanged = before.network !== after.network;
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

/**
 * Whether in-flight payment or verification work must be reset on wallet change.
 *
 * True whenever the active public key changes between sessions, such as on an
 * account switch, a disconnect, or a new connection.
 *
 * @param {object} [previous]
 * @param {object} [next]
 * @returns {boolean}
 */
function shouldResetPaySession(previous, next) {
  const before = normalizeWalletSession(previous);
  const after = normalizeWalletSession(next);
  return before.publicKey !== after.publicKey;
}

module.exports = {
  normalizeWalletSession,
  shouldClearSellerState,
  shouldResetPaySession,
  walletSessionChanged,
  walletSessionGate,
  walletSessionKey,
};
