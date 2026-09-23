const FREIGHTER_INSTALL_URL = 'https://www.freighter.app/';
const FREIGHTER_REQUIRED_MESSAGE =
  'You need the Freighter browser extension before you can create or pay an invoice.';
const FREIGHTER_CONNECT_REQUIRED_MESSAGE =
  'Connect Freighter to continue. Your wallet is your Quittance identity.';
const FREIGHTER_READY_MESSAGE = 'Freighter is connected on the correct Stellar network.';

const NETWORK_LABELS = Object.freeze({
  TESTNET: 'Testnet',
  PUBLIC: 'Mainnet',
  PUBNET: 'Mainnet',
  FUTURENET: 'Futurenet',
  STANDALONE: 'Standalone',
});

// Passphrases mirrored from shared/network.ts — this plain-JS module is loaded
// directly by node tests and cannot import the TS contract. A wallet-reported
// network NAME can lie (a custom network may call itself "TESTNET"); the
// passphrase cannot, so when Freighter reports it, it must match exactly.
const NETWORK_PASSPHRASES = Object.freeze({
  TESTNET: 'Test SDF Network ; September 2015',
  PUBLIC: 'Public Global Stellar Network ; September 2015',
});

const normalizeFreighterBoolean = (value, key) => {
  if (typeof value === 'boolean') return value;
  if (value && typeof value === 'object') {
    if (value.error) return false;
    if (typeof value[key] === 'boolean') return value[key];
  }
  return Boolean(value);
};

const normalizeNetworkName = (network) => {
  const value = String(network ?? '').trim().toUpperCase();
  if (value === 'PUBNET') return 'PUBLIC';
  return value || null;
};

const networkLabel = (network) => {
  const normalized = normalizeNetworkName(network);
  return normalized ? NETWORK_LABELS[normalized] || normalized : 'Unknown network';
};

const networkMatches = (actual, expected) => {
  const normalizedActual = normalizeNetworkName(actual);
  const normalizedExpected = normalizeNetworkName(expected);
  return Boolean(normalizedActual && normalizedExpected && normalizedActual === normalizedExpected);
};

/**
 * Gate check for the wallet session: when the session carries the passphrase
 * Freighter reported, it must equal the expected network's passphrase exactly.
 * Only when no passphrase was reported does the looser name check apply.
 */
const sessionNetworkMatches = (session, expected) => {
  if (session && session.networkPassphrase) {
    const expectedPassphrase = NETWORK_PASSPHRASES[normalizeNetworkName(expected)];
    return Boolean(expectedPassphrase && session.networkPassphrase === expectedPassphrase);
  }
  return networkMatches(session && session.network, expected);
};

const wrongNetworkMessage = (expectedNetwork, actualNetwork) =>
  `Switch Freighter to ${networkLabel(expectedNetwork)} to create or pay invoices. Current network: ${networkLabel(actualNetwork)}.`;

const FREIGHTER_WRONG_NETWORK_MESSAGE = (targetNetwork = 'Testnet') =>
  `Your Freighter wallet is connected to the wrong network. Please switch to ${targetNetwork} in Freighter.`;

/**
 * Treat a failed connection check as unavailable. This covers browsers where
 * the extension API is absent as well as extension injection failures.
 *
 * @param {() => Promise<boolean>} checkConnection
 * @returns {Promise<boolean>}
 */
const detectFreighter = async (checkConnection) => {
  try {
    return normalizeFreighterBoolean(await checkConnection(), 'isConnected');
  } catch {
    return false;
  }
};

/**
 * Checks if a network string or passphrase matches the expected network
 *
 * @param {string} [networkOrPassphrase]
 * @param {string} [expected='TESTNET']
 * @returns {boolean}
 */
const isNetworkMatching = (networkOrPassphrase, expected = 'TESTNET') => {
  if (!networkOrPassphrase) return false;
  const current = networkOrPassphrase.trim().toUpperCase();
  const exp = expected.trim().toUpperCase();
  if (current === exp) return true;
  if (exp === 'TESTNET' && current.includes('TEST SDF NETWORK')) return true;
  if ((exp === 'PUBLIC' || exp === 'MAINNET') && current.includes('PUBLIC GLOBAL STELLAR NETWORK')) return true;
  return false;
};

// The single answer to the question every create and pay surface asks: can
// this wallet act, and if not, which prompt gets it there?
//
// Four components and the pay-page state module each assemble that answer
// from the wallet store. One function keeps the banner, the toast and the
// submit button from disagreeing about why a wallet cannot proceed, and an
// unreported network counts as a mismatch: letting it through would enable a
// payment the verifier then rejects for NETWORK_MISMATCH.
const walletGate = (session, expectedNetwork = 'TESTNET') => {
  const freighterAvailable = session ? session.freighterAvailable : undefined;
  const connected = Boolean(session && session.connected && session.publicKey);

  if (freighterAvailable === false) {
    return {
      status: 'missing',
      ready: false,
      title: 'Install Freighter',
      message: FREIGHTER_REQUIRED_MESSAGE,
      action: 'install',
    };
  }

  if (!connected) {
    return {
      status: 'disconnected',
      ready: false,
      title: 'Connect Freighter',
      message: FREIGHTER_CONNECT_REQUIRED_MESSAGE,
      action: 'connect',
    };
  }

  if (!sessionNetworkMatches(session, expectedNetwork)) {
    return {
      status: 'wrong_network',
      ready: false,
      title: 'Wrong Stellar network',
      message: wrongNetworkMessage(expectedNetwork, session.network),
      action: 'switch_network',
    };
  }

  return {
    status: 'ready',
    ready: true,
    title: 'Freighter ready',
    message: FREIGHTER_READY_MESSAGE,
    action: 'none',
  };
};

module.exports = {
  FREIGHTER_INSTALL_URL,
  FREIGHTER_REQUIRED_MESSAGE,
  FREIGHTER_CONNECT_REQUIRED_MESSAGE,
  FREIGHTER_WRONG_NETWORK_MESSAGE,
  NETWORK_LABELS,
  detectFreighter,
  isNetworkMatching,
  normalizeFreighterBoolean,
  normalizeNetworkName,
  networkLabel,
  networkMatches,
  sessionNetworkMatches,
  walletGate,
  wrongNetworkMessage,
};
