/**
 * Namespaces the wallet storage key by network so persisted wallet state
 * does not leak across different networks (e.g. testnet vs public).
 *
 * @param network - Stellar network name or passphrase (e.g., 'TESTNET', 'PUBLIC')
 * @returns Namespaced storage key string
 */
export function walletStorageKey(network?: string | null): string {
  if (!network || typeof network !== 'string') {
    return 'wallet-storage';
  }

  const clean = network.trim().toLowerCase();
  if (!clean) {
    return 'wallet-storage';
  }

  return `wallet-storage:${clean}`;
}
