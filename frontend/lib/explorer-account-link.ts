/// <reference types="node" />
/**
 * Build a Stellar account explorer URL for the given public key and network.
 *
 * @param publicKey - Stellar public key.
 * @param network - Stellar network identifier the app is running on
 *   (typically TESTNET or PUBLIC). The helper maps it to the matching
 *   stellar.expert explorer path so wallet UIs can open the account in a
 *   browser without hard-coding URLs in components.
 */
export function buildHorizonAccountUrl(publicKey: string, network: string): string {
  const trimmedKey = publicKey.trim();
  if (!trimmedKey) {
    throw new Error('publicKey is required');
  }

  const normalizedNetwork = network.trim().toUpperCase();
  const explorerNetwork = normalizedNetwork === 'TESTNET' ? 'testnet' : 'public';

  return `https://stellar.expert/explorer/${explorerNetwork}/account/${trimmedKey}`;
}
