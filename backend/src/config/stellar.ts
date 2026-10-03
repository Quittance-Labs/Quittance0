import * as StellarSdk from '@stellar/stellar-sdk';
import dotenv from 'dotenv';

dotenv.config();

// Network configuration
import { SUPPORTED_STELLAR_NETWORKS } from '../../../shared/invoice-validation';
import {
  defaultHorizonUrl,
  explorerSegmentFor,
  passphraseFor,
  resolveStellarNetwork,
} from '../../../shared/network';

export { SUPPORTED_STELLAR_NETWORKS };
// One resolver for the whole process (issue #511): STELLAR_NETWORK decides
// the passphrase Freighter must report, the default Horizon URL, and the
// explorer segment proofs and links render.
export const STELLAR_NETWORK = resolveStellarNetwork(process.env.STELLAR_NETWORK);
export const STELLAR_HORIZON_URL =
  process.env.STELLAR_HORIZON_URL ||
  defaultHorizonUrl(STELLAR_NETWORK);

export const NETWORK_PASSPHRASE = passphraseFor(STELLAR_NETWORK);

export const STELLAR_EXPLORER_BASE =
  `https://stellar.expert/explorer/${explorerSegmentFor(STELLAR_NETWORK)}`;

/**
 * The SDK refuses a plaintext Horizon URL unless `allowHttp` is set.
 *
 * Plaintext is allowed only for a loopback address, which is what the
 * integration tests point at. A real Horizon is never reachable that way, so
 * this cannot silently downgrade a production deployment to HTTP.
 */
export const ALLOW_INSECURE_HORIZON =
  /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/i.test(STELLAR_HORIZON_URL);

// Stellar server instance
export const server = new StellarSdk.Horizon.Server(STELLAR_HORIZON_URL, {
  allowHttp: ALLOW_INSECURE_HORIZON,
});

// Seller account configuration
export const SELLER_PUBLIC_KEY = process.env.SELLER_PUBLIC_KEY || '';
export const SELLER_SECRET_KEY = process.env.SELLER_SECRET_KEY || '';

// Validate configuration
export const validateStellarConfig = () => {
  if (!SELLER_PUBLIC_KEY || !SELLER_SECRET_KEY) {
    throw new Error('Stellar account keys are not configured properly');
  }

  try {
    StellarSdk.Keypair.fromPublicKey(SELLER_PUBLIC_KEY);
  } catch (error) {
    throw new Error('Invalid SELLER_PUBLIC_KEY');
  }

  try {
    StellarSdk.Keypair.fromSecret(SELLER_SECRET_KEY);
  } catch (error) {
    throw new Error('Invalid SELLER_SECRET_KEY');
  }

  console.log(`✅ Stellar configured for ${STELLAR_NETWORK}`);
};

// Helper to get seller keypair
export const getSellerKeypair = () => {
  return StellarSdk.Keypair.fromSecret(SELLER_SECRET_KEY);
};

export default {
  server,
  STELLAR_NETWORK,
  NETWORK_PASSPHRASE,
  SELLER_PUBLIC_KEY,
  validateStellarConfig,
  getSellerKeypair,
};
