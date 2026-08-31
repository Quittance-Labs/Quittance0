// Horizon account explorer URL builder.
//
// Returns a direct link to the Stellar Expert account viewer for a given
// network. Keeps the network-specific base URLs in one place so UI components
// do not hardcode them.

const LAB_ACCOUNT_URL = {
  public: 'https://stellar.expert/explorer/public/account',
  testnet: 'https://stellar.expert/explorer/testnet/account',
};

/**
 * Build a Horizon account explorer URL for a Stellar public key.
 *
 * @param {string | undefined | null} publicKey - Stellar account public key.
 * @param {'public' | 'testnet'} [network='public'] - Network name.
 * @returns {string | null} Full explorer URL, or null when the public key is missing or malformed.
 */
function buildHorizonAccountUrl(publicKey, network = 'public') {
  if (!publicKey || typeof publicKey !== 'string') {
    return null;
  }

  const normalizedKey = publicKey.trim();
  // Stellar public keys are 56-character base32 strings starting with G.
  if (!/^[G][A-Z2-7]{55}$/.test(normalizedKey)) {
    return null;
  }

  const baseUrl = LAB_ACCOUNT_URL[network] ?? LAB_ACCOUNT_URL.public;
  return `${baseUrl}/${normalizedKey}`;
}

module.exports = { buildHorizonAccountUrl };
