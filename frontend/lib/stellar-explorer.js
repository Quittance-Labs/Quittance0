// Horizon transaction explorer URL builder - the single implementation.
//
// explorer-tx-link.ts re-exports this so typed callers keep their import path,
// and the mailto helpers require it directly. The module name is deliberately
// not "explorer-tx-link.js": the shared export-test loader maps both
// './explorer-tx-link' and './explorer-tx-link.js' to the .ts file, so an
// implementation with that base name would shadow itself.

const EXPLORER_TX_URLS = {
  public: 'https://stellar.expert/explorer/public/tx',
  testnet: 'https://stellar.expert/explorer/testnet/tx',
};

// Same default as lib/stellar.ts: without NEXT_PUBLIC_STELLAR_NETWORK the app
// talks to testnet, so explorer links must point there too.
const DEFAULT_STELLAR_NETWORK = 'TESTNET';

/**
 * Which explorer an invoice's transaction lives on.
 *
 * The rule has one home because three surfaces link to a transaction -- the
 * receipt, the proof email and the print/PDF export -- and a hardcoded
 * 'public' in any of them sends a testnet seller to a mainnet page that will
 * never show their transaction.
 *
 * Precedence: the invoice's own network, then the app configuration, then the
 * app default (TESTNET).
 *
 * @param {{ network?: string } | string | null} [invoiceOrNetwork] Invoice
 *   record, or a bare network name, to resolve.
 * @returns {'public' | 'testnet'}
 */
function resolveExplorerNetwork(invoiceOrNetwork) {
  const configured =
    (typeof invoiceOrNetwork === 'string' ? invoiceOrNetwork : invoiceOrNetwork?.network) ||
    (typeof process !== 'undefined' && process.env && process.env.NEXT_PUBLIC_STELLAR_NETWORK) ||
    DEFAULT_STELLAR_NETWORK;
  const normalized = String(configured).trim().toUpperCase();
  return normalized === 'PUBLIC' || normalized === 'MAINNET' ? 'public' : 'testnet';
}

/**
 * Build a Horizon transaction explorer URL for a transaction hash.
 *
 * @param {unknown} txHash - Stellar transaction hash (64-character hex string).
 * @param {string} [network='public'] - Network name; defaults to 'public'.
 * @returns {string|null} Full explorer URL, or null when the hash is missing or malformed.
 */
function buildHorizonTxUrl(txHash, network = 'public') {
  if (typeof txHash !== 'string') {
    return null;
  }

  const normalizedHash = txHash.trim();
  if (!/^[a-fA-F0-9]{64}$/.test(normalizedHash)) {
    return null;
  }

  const baseUrl = EXPLORER_TX_URLS[network] ?? EXPLORER_TX_URLS.public;
  return baseUrl + '/' + normalizedHash;
}

module.exports = { buildHorizonTxUrl, resolveExplorerNetwork };
