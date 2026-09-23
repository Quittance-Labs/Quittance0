/**
 * Horizon transaction explorer URL builder.
 *
 * Returns a direct link to the Stellar Expert transaction viewer for a given
 * network. Keeps the network-specific base URLs in one place so UI components
 * do not hardcode them.
 *
 * Note: This mirrors frontend/lib/explorer-tx-link.ts for server-side use.
 */

import {
  resolveStellarNetwork,
  explorerSegmentFor,
} from '../../../shared/network';

const EXPLORER_TX_URLS: Record<string, string> = {
  public: 'https://stellar.expert/explorer/public/tx',
  testnet: 'https://stellar.expert/explorer/testnet/tx',
};

/**
 * Build a Horizon transaction explorer URL for a transaction hash.
 *
 * @param txHash - Stellar transaction hash (64-character hex string).
 * @param network - Network name; defaults to resolved STELLAR_NETWORK.
 * @returns Full explorer URL, or null when the hash is missing or malformed.
 */
export function buildHorizonTxUrl(
  txHash: unknown,
  network?: string
): string | null {
  if (typeof txHash !== 'string') {
    return null;
  }

  const normalizedHash = txHash.trim();
  if (!/^[a-fA-F0-9]{64}$/.test(normalizedHash)) {
    return null;
  }

  const segment =
    network && EXPLORER_TX_URLS[network.toLowerCase()]
      ? network.toLowerCase()
      : explorerSegmentFor(resolveStellarNetwork(process.env.STELLAR_NETWORK));
  const baseUrl = EXPLORER_TX_URLS[segment] ?? EXPLORER_TX_URLS.testnet;
  return `${baseUrl}/${normalizedHash}`;
}

export default {
  buildHorizonTxUrl,
  EXPLORER_TX_URLS,
};
