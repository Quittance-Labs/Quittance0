// QR payment payload formatter.
//
// Serializes Stellar payment parameters into a consistent SEP-0007 style URI
// string that can be encoded into a QR code. The formatter is intentionally
// pure: it builds the payload string from validated inputs and does not touch
// any QR generation library.

import { Keypair } from '@stellar/stellar-sdk';

/**
 * Asset description used inside a QR payment payload.
 */
export interface QrPaymentAsset {
  /** Asset code, e.g. "XLM" or "USDC". */
  code: string;
  /**
   * Stellar public key of the asset issuer.
   * Required for non-native assets and ignored for XLM.
   */
  issuer?: string;
}

/**
 * Input parameters for formatting a Stellar payment QR payload.
 */
export interface QrPaymentPayloadInput {
  /** Stellar public key of the payment destination. */
  destination: string;
  /** Payment amount as a string to preserve precision. */
  amount: string;
  /** Optional text memo attached to the payment. */
  memo?: string;
  /**
   * Optional asset description. Defaults to the native asset (XLM).
   * When a non-native asset is supplied, issuer must be provided.
   */
  asset?: QrPaymentAsset;
}

/**
 * Result of formatting a QR payment payload.
 *
 * Contains both the SEP-0007 style URI and a stable ordered representation of
 * the query parameters so callers can inspect or transform the payload.
 */
export interface QrPaymentPayload {
  /** Full web+stellar URI ready for QR encoding. */
  uri: string;
  /** Ordered map of query parameters that make up the URI. */
  params: Record<string, string>;
}

/**
 * Validate that a string looks like a Stellar public key.
 */
const isValidPublicKey = (publicKey: string): boolean => {
  try {
    Keypair.fromPublicKey(publicKey);
    return true;
  } catch {
    return false;
  }
};

/**
 * Build a SEP-0007 style Stellar payment URI and its parameter map.
 *
 * The returned URI uses the `web+stellar:pay?` scheme. Parameters are appended
 * in a deterministic order:
 *   1. destination
 *   2. amount
 *   3. asset_code (only when asset is non-native)
 *   4. asset_issuer (only when asset is non-native)
 *   5. memo + memo_type (only when memo is provided)
 *
 * @param input - Payment details.
 * @returns Object containing the full URI and an ordered parameter map.
 * @throws When destination is missing or not a valid Stellar public key.
 * @throws When amount is missing or not a positive numeric string.
 * @throws When a non-native asset is supplied without an issuer.
 */
export const formatQrPaymentPayload = (
  input: QrPaymentPayloadInput,
): QrPaymentPayload => {
  const { destination, amount, memo, asset } = input;

  if (!destination || typeof destination !== 'string') {
    throw new Error('destination is required');
  }

  if (!isValidPublicKey(destination)) {
    throw new Error('destination must be a valid Stellar public key');
  }

  if (amount === undefined || amount === null || amount === '') {
    throw new Error('amount is required');
  }

  if (typeof amount !== 'string') {
    throw new Error('amount must be a string');
  }

  if (!/^\d+(\.\d+)?$/.test(amount) || Number(amount) <= 0) {
    throw new Error('amount must be a positive number');
  }

  const assetCode = asset?.code?.trim().toUpperCase() || 'XLM';
  const assetIssuer = asset?.issuer?.trim();
  const isNative = assetCode === 'XLM';

  if (!isNative && !assetIssuer) {
    throw new Error(`asset issuer is required for ${assetCode}`);
  }

  if (!isNative && assetIssuer && !isValidPublicKey(assetIssuer)) {
    throw new Error('asset issuer must be a valid Stellar public key');
  }

  const params: Record<string, string> = {
    destination,
    amount,
  };

  if (!isNative && assetIssuer) {
    params.asset_code = assetCode;
    params.asset_issuer = assetIssuer;
  }

  if (memo !== undefined && memo !== null && memo !== '') {
    params.memo = memo;
    params.memo_type = 'MEMO_TEXT';
  }

  const query = Object.entries(params)
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join('&');

  const uri = `web+stellar:pay?${query}`;

  return { uri, params };
};

export default {
  formatQrPaymentPayload,
};
