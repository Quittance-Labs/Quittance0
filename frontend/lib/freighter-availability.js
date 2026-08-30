const FREIGHTER_INSTALL_URL = 'https://www.freighter.app/';
const FREIGHTER_REQUIRED_MESSAGE =
  'You need the Freighter browser extension before you can create or pay an invoice.';

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

module.exports = {
  FREIGHTER_INSTALL_URL,
  FREIGHTER_REQUIRED_MESSAGE,
  detectFreighter,
};
