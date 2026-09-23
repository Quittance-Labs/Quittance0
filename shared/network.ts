/**
 * Canonical Stellar network definitions and resolver.
 *
 * Pinned across backend config, frontend runtime, Freighter wallet gates,
 * Horizon instances, explorer URLs, and Quittance proofs.
 */

export const SUPPORTED_STELLAR_NETWORKS = ['TESTNET', 'PUBLIC'] as const;

export type StellarNetwork = (typeof SUPPORTED_STELLAR_NETWORKS)[number];

export const TESTNET_PASSPHRASE = 'Test SDF Network ; September 2015';
export const PUBLIC_PASSPHRASE = 'Public Global Stellar Network ; September 2015';

export const NETWORK_DETAILS: Record<
  StellarNetwork,
  {
    passphrase: string;
    horizonUrl: string;
    explorerSegment: 'testnet' | 'public';
    displayName: string;
  }
> = {
  TESTNET: {
    passphrase: TESTNET_PASSPHRASE,
    horizonUrl: 'https://horizon-testnet.stellar.org',
    explorerSegment: 'testnet',
    displayName: 'Testnet',
  },
  PUBLIC: {
    passphrase: PUBLIC_PASSPHRASE,
    horizonUrl: 'https://horizon.stellar.org',
    explorerSegment: 'public',
    displayName: 'Public Global Stellar Network',
  },
};

/**
 * Resolves a raw string or undefined to a supported StellarNetwork.
 * Defaults to 'TESTNET' if empty or omitted.
 * Case-insensitive and trimmed. Throws on unrecognized networks.
 */
export function resolveStellarNetwork(raw?: string | null): StellarNetwork {
  const trimmed = (raw ?? '').trim().toUpperCase();
  if (!trimmed) {
    return 'TESTNET';
  }
  if ((SUPPORTED_STELLAR_NETWORKS as readonly string[]).includes(trimmed)) {
    return trimmed as StellarNetwork;
  }
  throw new Error(
    `Stellar network must be one of ${SUPPORTED_STELLAR_NETWORKS.join(', ')}; got "${raw}"`
  );
}

/**
 * Returns the official Stellar network passphrase for the given network.
 */
export function passphraseFor(network: StellarNetwork): string {
  return NETWORK_DETAILS[network].passphrase;
}

/**
 * Returns the default public Horizon URL for the given network.
 */
export function defaultHorizonUrl(network: StellarNetwork): string {
  return NETWORK_DETAILS[network].horizonUrl;
}

/**
 * Returns the stellar.expert explorer URL path segment ('testnet' | 'public').
 */
export function explorerSegmentFor(network: StellarNetwork): 'testnet' | 'public' {
  return NETWORK_DETAILS[network].explorerSegment;
}

/**
 * Verifies whether a reported wallet session matches the target network.
 * Prioritizes cryptographic networkPassphrase comparison when available.
 */
export function walletNetworkMatches(
  network: StellarNetwork,
  reported: { network?: string | null; networkPassphrase?: string | null }
): boolean {
  if (!reported.networkPassphrase && !reported.network) {
    return false;
  }
  if (reported.networkPassphrase && reported.networkPassphrase.trim() !== passphraseFor(network)) {
    return false;
  }
  if (reported.network) {
    const raw = reported.network.trim().toUpperCase();
    const normalized = raw === 'MAINNET' || raw === 'PUBNET' ? 'PUBLIC' : raw;
    if (normalized !== network && reported.network.trim() !== passphraseFor(network)) {
      return false;
    }
  }
  return true;
}
