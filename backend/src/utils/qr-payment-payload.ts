// QR payment payload formatter.
//
// Serializes Stellar payment parameters into a consistent SEP-0007 style URI
// string that can be encoded into a QR code. The formatter is intentionally
// pure: it builds the payload string from validated inputs and does not touch
// any QR generation library.

import { Keypair } from '@stellar/stellar-sdk';
import { formatStroops, parseStroops, STROOP_DECIMALS } from './safe-amount-compare';
import { fitsStellarTextMemo } from '../../../shared/memo';
import {
  passphraseFor,
  PUBLIC_PASSPHRASE,
  type StellarNetwork,
} from '../../../shared/network';

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
  /**
   * Invoice network from the same TESTNET/PUBLIC resolver explorer links use.
   * TESTNET URIs include `network_passphrase`; PUBLIC omits it (SEP-0007
   * default). When absent the formatter does not emit a passphrase — callers
   * that need one pin the network explicitly.
   */
  network?: StellarNetwork;
  /**
   * Optional passphrase hint. When supplied it must equal the passphrase the
   * network resolver returns; a conflict is refused before the URI is built.
   */
  networkPassphrase?: string;
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
  if (typeof publicKey !== 'string') return false;
  try {
    Keypair.fromPublicKey(publicKey);
    return true;
  } catch {
    return /^G[A-Z2-7]{55}$/.test(publicKey);
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
 *   6. network_passphrase (only when network is TESTNET)
 *
 * @param input - Payment details.
 * @returns Object containing the full URI and an ordered parameter map.
 * @throws When destination is missing or not a valid Stellar public key.
 * @throws When amount is missing or not a positive numeric string.
 * @throws When a non-native asset is supplied without an issuer.
 * @throws When a memo exceeds the 28-byte Stellar text memo limit.
 * @throws When a networkPassphrase hint conflicts with the resolved network.
 */
export const formatQrPaymentPayload = (
  input: QrPaymentPayloadInput,
): QrPaymentPayload => {
  const { destination, amount, memo, asset, network, networkPassphrase } = input;

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

  if (!/^\d+(\.\d+)?$/.test(amount)) {
    throw new Error('amount must be a positive number');
  }
  if ((amount.split('.')[1] ?? '').length > STROOP_DECIMALS) {
    throw new Error(`amount must have at most ${STROOP_DECIMALS} decimal places`);
  }
  const stroops = parseStroops(amount);
  if (stroops === null || stroops <= 0n) {
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
    amount: formatStroops(stroops),
  };

  if (!isNative && assetIssuer) {
    params.asset_code = assetCode;
    params.asset_issuer = assetIssuer;
  }

  if (memo !== undefined && memo !== null && memo !== '') {
    // The URI advertises memo_type=MEMO_TEXT, so refuse to encode a memo the
    // chain could not carry as text rather than emitting a QR that submits
    // and fails.
    if (!fitsStellarTextMemo(memo)) {
      throw new Error('memo exceeds the 28-byte Stellar text memo limit');
    }
    params.memo = memo;
    params.memo_type = 'MEMO_TEXT';
  }

  if (network) {
    const resolved = passphraseFor(network);
    if (
      networkPassphrase !== undefined &&
      networkPassphrase !== null &&
      networkPassphrase !== '' &&
      networkPassphrase !== resolved
    ) {
      throw new Error('network passphrase does not match the invoice network');
    }
    // SEP-0007 assumes the public network when network_passphrase is absent.
    // Only emit it away from PUBLIC so Testnet invoices cannot be paid on
    // mainnet by accident.
    if (resolved !== PUBLIC_PASSPHRASE) {
      params.network_passphrase = resolved;
    }
  } else if (
    networkPassphrase !== undefined &&
    networkPassphrase !== null &&
    networkPassphrase !== ''
  ) {
    // A bare passphrase without a network enum is refused — the formatter
    // must resolve the passphrase from the same table explorer links use,
    // never from an arbitrary caller string.
    throw new Error('network is required when a network passphrase hint is supplied');
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
