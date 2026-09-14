/**
 * Build a Stellar account explorer URL for the given public key and network.
 *
 * @param {string} publicKey - Stellar public key.
 * @param {string} network - Stellar network identifier the app is running on
 *   (typically TESTNET or PUBLIC).
 */
function buildHorizonAccountUrl(publicKey, network) {
  const trimmedKey = typeof publicKey === 'string' ? publicKey.trim() : '';
  if (!trimmedKey) {
    throw new Error('publicKey is required');
  }

  const normalizedNetwork = typeof network === 'string' ? network.trim().toUpperCase() : '';
  const explorerNetwork = normalizedNetwork === 'TESTNET' ? 'testnet' : 'public';

  return `https://stellar.expert/explorer/${explorerNetwork}/account/${trimmedKey}`;
}

module.exports = { buildHorizonAccountUrl };
