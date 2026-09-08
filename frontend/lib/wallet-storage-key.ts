// Wallet localStorage key helper.
// Centralises the keys used to persist wallet-related state so names stay
// consistent and collisions are avoided across networks.

const NETWORKS: Record<string, string> = Object.freeze({
  PUBLIC: 'public',
  TESTNET: 'testnet',
});

/**
 * Return the localStorage key for persisted wallet selection on a given network.
 *
 * @param network - Stellar network name.
 * @returns localStorage key.
 */
export function walletStorageKey(network: unknown): string {
  const key = typeof network === 'string' ? network.trim().toLowerCase() : 'unknown';
  const safeNetwork = NETWORKS[key.toUpperCase()] ?? key;
  return `quittance:wallet:${safeNetwork}`;
}
