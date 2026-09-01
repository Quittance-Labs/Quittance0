const FREIGHTER_INSTALL_URL = 'https://www.freighter.app/';
const FREIGHTER_REQUIRED_MESSAGE =
  'You need the Freighter browser extension before you can create or pay an invoice.';

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
    return Boolean(await checkConnection());
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
