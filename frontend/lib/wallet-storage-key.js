// Wallet localStorage key helper.
//
// Centralises the keys used to persist wallet-related state so names stay
// consistent and collisions are avoided.

const WALLET_STORAGE_KEYS = Object.freeze({
  publicKey: 'quittance:wallet:publicKey',
  balance: 'quittance:wallet:balance',
  connected: 'quittance:wallet:connected',
  network: 'quittance:wallet:network',
});

/**
 * Return the localStorage key for a given wallet state item.
 *
 * @param {'publicKey' | 'balance' | 'connected' | 'network'} name - Wallet state item.
 * @returns {string} localStorage key.
 */
function walletStorageKey(name) {
  return WALLET_STORAGE_KEYS[name] ?? name;
}

module.exports = { walletStorageKey, WALLET_STORAGE_KEYS };
