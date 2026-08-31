// Horizon transaction explorer URL builder.
//
// Returns a direct link to the Stellar Expert transaction viewer for a given
// network. Keeps the network-specific base URLs in one place so UI components
// do not hardcode them.

const LAB_TX_URL = {
  public: 'https://stellar.expert/explorer/public/tx',
  testnet: 'https://stellar.expert/explorer/testnet/tx',
};

/**
 * Build a Horizon transaction explorer URL for a transaction hash.
 *
 * @param {string | undefined | null} txHash - Stellar transaction hash (64-character hex string).
 * @param {'public' | 'testnet'} [network='public'] - Network name.
 * @returns {string | null} Full explorer URL, or null when the hash is missing or malformed.
 */
function buildHorizonTxUrl(txHash, network = 'public') {
  if (!txHash || typeof txHash !== 'string') {
    return null;
  }

  const normalizedHash = txHash.trim();
  if (!/^[a-fA-F0-9]{64}$/.test(normalizedHash)) {
    return null;
  }

  const baseUrl = LAB_TX_URL[network] ?? LAB_TX_URL.public;
  return `${baseUrl}/${normalizedHash}`;
}

module.exports = { buildHorizonTxUrl };
