// Horizon transaction explorer URL builder.
// Returns a direct link to the Stellar Expert transaction viewer for a given
// network. Keeps the network-specific base URLs in one place so UI components
// do not hardcode them.

const EXPLORER_TX_URLS: Record<string, string> = {
  public: 'https://stellar.expert/explorer/public/tx',
  testnet: 'https://stellar.expert/explorer/testnet/tx',
};

/**
 * Build a Horizon transaction explorer URL for a transaction hash.
 *
 * @param txHash - Stellar transaction hash (64-character hex string).
 * @param network - Network name; defaults to 'public'.
 * @returns Full explorer URL, or null when the hash is missing or malformed.
 */
export function buildHorizonTxUrl(
  txHash: unknown,
  network: string = 'public'
): string | null {
  if (typeof txHash !== 'string') {
    return null;
  }

  const normalizedHash = txHash.trim();
  if (!/^[a-fA-F0-9]{64}$/.test(normalizedHash)) {
    return null;
  }

  const baseUrl = EXPLORER_TX_URLS[network] ?? EXPLORER_TX_URLS.public;
  return `${baseUrl}/${normalizedHash}`;
}
