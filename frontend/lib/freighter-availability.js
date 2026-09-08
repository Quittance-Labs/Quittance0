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

const walletGate = (session = {}, expectedNetwork = 'TESTNET') => {
  if (session.freighterAvailable === false) {
    return {
      status: 'missing',
      ready: false,
      title: 'Install Freighter',
      message: FREIGHTER_REQUIRED_MESSAGE,
      action: 'install',
    };
  }

  if (!session.connected || !session.publicKey) {
    return {
      status: 'disconnected',
      ready: false,
      title: 'Connect Freighter',
      message: FREIGHTER_CONNECT_REQUIRED_MESSAGE,
      action: 'connect',
    };
  }

  if (!networkMatches(session.network, expectedNetwork)) {
    return {
      status: 'wrong_network',
      ready: false,
      title: 'Switch Freighter network',
      message: wrongNetworkMessage(expectedNetwork, session.network),
      action: 'switch_network',
    };
  }

  return {
    status: 'ready',
    ready: true,
    title: 'Freighter connected',
    message: FREIGHTER_READY_MESSAGE,
    action: 'continue',
  };
};

module.exports = {
  FREIGHTER_INSTALL_URL,
  FREIGHTER_REQUIRED_MESSAGE,
  FREIGHTER_CONNECT_REQUIRED_MESSAGE,
  FREIGHTER_READY_MESSAGE,
  NETWORK_LABELS,
  detectFreighter,
  normalizeFreighterBoolean,
  normalizeNetworkName,
  networkLabel,
  networkMatches,
  walletGate,
  wrongNetworkMessage,
};
