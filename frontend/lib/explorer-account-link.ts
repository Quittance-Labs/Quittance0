// Horizon account explorer URL builder.
// Returns a direct link to the Stellar Expert account viewer for a given
// network. Keeps the network-specific base URLs in one place so UI components
// do not hardcode them.

const EXPLORER_ACCOUNT_URLS: Record<string, string> = {
  public: 'https://stellar.expert/explorer/public/account',
  testnet: 'https://stellar.expert/explorer/testnet/account',
};

/**
 * Build a Horizon account explorer URL for a Stellar public key.
 *
 * @param publicKey - Stellar account public key.
 * @param network - Network name; defaults to 'public'.
 * @returns Full explorer URL, or null when the public key is missing or malformed.
 */
export function buildHorizonAccountUrl(
  publicKey: unknown,
  network: string = 'public'
): string | null {
  if (typeof publicKey !== 'string') {
    return null;
  }

  const normalizedKey = publicKey.trim();
  // Stellar public keys are 56-character base32 strings starting with G.
  if (!/^[G][A-Z2-7]{55}$/.test(normalizedKey)) {
    return null;
  }

  const baseUrl = EXPLORER_ACCOUNT_URLS[network] ?? EXPLORER_ACCOUNT_URLS.public;
  return `${baseUrl}/${normalizedKey}`;
}
