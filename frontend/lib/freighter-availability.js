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

module.exports = {
  FREIGHTER_INSTALL_URL,
  FREIGHTER_REQUIRED_MESSAGE,
  FREIGHTER_WRONG_NETWORK_MESSAGE,
  detectFreighter,
  isNetworkMatching,
};
