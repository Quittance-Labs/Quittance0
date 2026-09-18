/**
 * Dedicated Freighter payment transaction builder and validation pipeline.
 *
 * Enforces strict destination, amount, asset, fee, and memo safety before prompting
 * wallet signatures, produces human-readable review summaries, and classifies errors
 * distinguishing transport outages from verification rejections.
 */

import * as StellarSdk from '@stellar/stellar-sdk';
import { parseAmountInput } from './parse-amount-input.ts';
import {
  networkMatches,
  networkLabel,
  wrongNetworkMessage,
  FREIGHTER_REQUIRED_MESSAGE,
} from './freighter-availability.js';
import { formatAddress } from './utils.ts';
import { isHorizonOutageError, HORIZON_OUTAGE_MESSAGE } from './horizon-outage.js';

/** Standard base fee in stroops for Stellar transactions. */
export const BASE_FEE_STROOPS = '100';

/** Standard base fee in XLM for Stellar transactions. */
export const BASE_FEE_XLM = '0.00001';

/** Regular expression validating standard 56-character Ed25519 public keys starting with G. */
export const STELLAR_PUBKEY_REGEX = /^G[A-Z2-7]{55}$/;

/** Regular expression validating alphanumeric asset codes between 1 and 12 characters. */
export const ASSET_CODE_REGEX = /^[A-Za-z0-9]{1,12}$/;

/** Maximum allowed UTF-8 byte length for Stellar text memos. */
export const MAX_MEMO_BYTES = 28;

/** Default expected Stellar network when not specified by environment. */
export const DEFAULT_EXPECTED_NETWORK = (
  process.env.NEXT_PUBLIC_STELLAR_NETWORK || 'TESTNET'
).toUpperCase();

/**
 * Parameters supplied to the payment builder.
 */
export interface PaymentBuilderParams {
  destination: string;
  amount: string | number;
  memo: string;
  assetCode?: string;
  assetIssuer?: string;
  invoiceMemo?: string;
}

/**
 * Human-readable review summary of a payment transaction.
 */
export interface PaymentSummary {
  destination: string;
  shortDestination: string;
  amount: string;
  numericAmount: number;
  assetCode: string;
  assetIssuer?: string;
  memo: string;
  network: string;
  expectedNetwork: string;
  fee: string;
}

/**
 * Result of validating payment parameters.
 */
export interface ValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Categorical type of classified payment error.
 */
export type PaymentErrorType =
  | 'VALIDATION_ERROR'
  | 'NETWORK_MISMATCH'
  | 'WALLET_REQUIRED'
  | 'WALLET_REJECTED'
  | 'TRUSTLINE_REQUIRED'
  | 'ACCOUNT_UNFUNDED'
  | 'TRANSPORT_ERROR'
  | 'VERIFICATION_REJECTED'
  | 'UNKNOWN';

/**
 * Structured classification of a payment failure.
 */
export interface ClassifiedPaymentError {
  type: PaymentErrorType;
  message: string;
  retryable: boolean;
  rawError?: unknown;
}

/**
 * Validates whether a given value is a valid Stellar Ed25519 public key.
 *
 * @param key - The candidate key string.
 * @returns True if valid 56-character G-address, false otherwise.
 */
export function isValidStellarPublicKey(key: unknown): boolean {
  if (typeof key !== 'string') {
    return false;
  }
  const trimmed = key.trim();
  if (!STELLAR_PUBKEY_REGEX.test(trimmed)) {
    return false;
  }
  try {
    return StellarSdk.StrKey.isValidEd25519PublicKey(trimmed);
  } catch {
    return false;
  }
}

/**
 * Computes the UTF-8 byte length of a string.
 *
 * @param str - The string to measure.
 * @returns Number of UTF-8 bytes.
 */
export function getUtf8ByteLength(str: string): number {
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(str).length;
  }
  return Buffer.byteLength(str, 'utf8');
}

/**
 * Validates payment parameters prior to initiating a transaction.
 *
 * @param params - The payment builder parameters.
 * @returns ValidationResult indicating validity and optional error description.
 */
export function validatePaymentInvoice(params: PaymentBuilderParams): ValidationResult {
  if (!params) {
    return { valid: false, error: 'Payment parameters are required.' };
  }

  if (!params.destination || !params.destination.trim()) {
    return { valid: false, error: 'Recipient destination address is required.' };
  }
  const destination = params.destination.trim();
  if (!isValidStellarPublicKey(destination)) {
    return {
      valid: false,
      error: 'Recipient destination must be a valid 56-character Stellar public key (starting with G).',
    };
  }

  if (params.amount === undefined || params.amount === null || String(params.amount).trim() === '') {
    return { valid: false, error: 'Payment amount is required.' };
  }
  const parsedAmount = parseAmountInput(params.amount);
  if (parsedAmount === null || parsedAmount <= 0) {
    return {
      valid: false,
      error: 'Payment amount must be a positive number with at most 7 decimal places.',
    };
  }

  if (!params.memo || typeof params.memo !== 'string' || !params.memo.trim()) {
    return { valid: false, error: 'Invoice payment memo is required.' };
  }
  const memo = params.memo.trim();
  if (getUtf8ByteLength(memo) > MAX_MEMO_BYTES) {
    return {
      valid: false,
      error: `Payment memo exceeds maximum length of ${MAX_MEMO_BYTES} UTF-8 bytes.`,
    };
  }
  if (params.invoiceMemo !== undefined && params.invoiceMemo !== null) {
    const expectedMemo = String(params.invoiceMemo).trim();
    if (memo !== expectedMemo) {
      return {
        valid: false,
        error: `Payment memo does not match invoice memo "${expectedMemo}".`,
      };
    }
  }

  const assetCode = (params.assetCode || 'XLM').trim().toUpperCase();
  if (!ASSET_CODE_REGEX.test(assetCode)) {
    return {
      valid: false,
      error: 'Asset code must be between 1 and 12 alphanumeric characters.',
    };
  }
  if (assetCode !== 'XLM') {
    if (!params.assetIssuer || !isValidStellarPublicKey(params.assetIssuer)) {
      return {
        valid: false,
        error: `Asset issuer public key is required for non-XLM asset ${assetCode}.`,
      };
    }
  }

  return { valid: true };
}

/**
 * Builds a human-readable payment review summary.
 *
 * @param params - The payment builder parameters.
 * @param currentNetwork - The detected wallet network name or passphrase.
 * @returns Structured PaymentSummary.
 */
export function buildPaymentSummary(
  params: PaymentBuilderParams,
  currentNetwork?: string | null
): PaymentSummary {
  const validation = validatePaymentInvoice(params);
  if (!validation.valid) {
    throw new Error(validation.error || 'Invalid payment parameters');
  }

  const destination = params.destination.trim();
  const parsedAmount = parseAmountInput(params.amount)!;
  const assetCode = (params.assetCode || 'XLM').trim().toUpperCase();
  const memo = params.memo.trim();
  const network = currentNetwork
    ? networkLabel(currentNetwork)
    : networkLabel(DEFAULT_EXPECTED_NETWORK);

  return {
    destination,
    shortDestination: formatAddress(destination, 6),
    amount: parsedAmount.toFixed(7),
    numericAmount: parsedAmount,
    assetCode,
    assetIssuer: assetCode !== 'XLM' ? params.assetIssuer?.trim() : undefined,
    memo,
    network,
    expectedNetwork: networkLabel(DEFAULT_EXPECTED_NETWORK),
    fee: BASE_FEE_XLM,
  };
}

/**
 * Classifies errors into typed categories to distinguish transport outages,
 * user cancellations, and verification rejects.
 *
 * @param error - Caught error object or message string.
 * @returns ClassifiedPaymentError with structured type and user message.
 */
export function classifyPaymentError(error: unknown): ClassifiedPaymentError {
  if (!error) {
    return {
      type: 'UNKNOWN',
      message: 'An unknown payment error occurred.',
      retryable: false,
    };
  }

  if (isHorizonOutageError(error)) {
    return {
      type: 'TRANSPORT_ERROR',
      message: HORIZON_OUTAGE_MESSAGE,
      retryable: true,
      rawError: error,
    };
  }

  const msg = typeof error === 'string' ? error : (error as any)?.message || String(error);
  const lower = msg.toLowerCase();

  if (lower.includes('wrong network') || lower.includes('switch freighter to')) {
    return {
      type: 'NETWORK_MISMATCH',
      message: msg,
      retryable: true,
      rawError: error,
    };
  }

  if (
    lower.includes('install freighter') ||
    lower.includes('not installed') ||
    lower.includes('connect freighter')
  ) {
    return {
      type: 'WALLET_REQUIRED',
      message: msg,
      retryable: true,
      rawError: error,
    };
  }

  if (
    lower.includes('user declined') ||
    lower.includes('denied') ||
    lower.includes('cancelled') ||
    lower.includes('rejected by user')
  ) {
    return {
      type: 'WALLET_REJECTED',
      message: 'Payment was cancelled in Freighter.',
      retryable: true,
      rawError: error,
    };
  }

  if (lower.includes('trustline') || lower.includes('op_no_trust')) {
    return {
      type: 'TRUSTLINE_REQUIRED',
      message: msg,
      retryable: true,
      rawError: error,
    };
  }

  if (
    lower.includes('not funded') ||
    lower.includes('needs funding') ||
    lower.includes('op_underfunded')
  ) {
    return {
      type: 'ACCOUNT_UNFUNDED',
      message: msg,
      retryable: true,
      rawError: error,
    };
  }

  if (
    lower.includes('network error') ||
    lower.includes('timeout') ||
    lower.includes('econnrefused') ||
    lower.includes('etimedout') ||
    (error as any)?.code === 'ERR_NETWORK' ||
    [502, 503, 504].includes((error as any)?.response?.status)
  ) {
    return {
      type: 'TRANSPORT_ERROR',
      message: 'Stellar network is temporarily unreachable. Please retry shortly.',
      retryable: true,
      rawError: error,
    };
  }

  if (
    lower.includes('verification') ||
    lower.includes('memo_mismatch') ||
    lower.includes('amount_too_low') ||
    lower.includes('destination_mismatch')
  ) {
    return {
      type: 'VERIFICATION_REJECTED',
      message: msg,
      retryable: false,
      rawError: error,
    };
  }

  return {
    type: 'UNKNOWN',
    message: msg || 'Payment could not be completed.',
    retryable: true,
    rawError: error,
  };
}

/**
 * Validates parameters and submits a payment transaction through Freighter.
 *
 * @param params - The payment builder parameters.
 * @param session - Current wallet session state.
 * @returns Promise resolving to the transaction hash upon success.
 */
export async function buildAndSubmitFreighterPayment(
  params: PaymentBuilderParams,
  session?: {
    freighterAvailable?: boolean;
    connected?: boolean;
    publicKey?: string | null;
    network?: string | null;
  }
): Promise<string> {
  const validation = validatePaymentInvoice(params);
  if (!validation.valid) {
    throw new Error(validation.error);
  }

  const expectedNetwork = DEFAULT_EXPECTED_NETWORK;
  let freighterInstalled = session?.freighterAvailable;
  let activeNetwork = session?.network;
  let isConnected = session?.connected;

  if (freighterInstalled === undefined || !activeNetwork || !isConnected) {
    const stellar = await import('./stellar.ts');
    if (freighterInstalled === undefined) {
      freighterInstalled = await stellar.checkWalletConnection();
    }
    if (!freighterInstalled) {
      throw new Error(FREIGHTER_REQUIRED_MESSAGE);
    }
    if (!activeNetwork) {
      const netDetails = await stellar.getFreighterNetwork();
      activeNetwork = netDetails?.networkPassphrase || netDetails?.network;
    }
    if (!networkMatches(activeNetwork, expectedNetwork)) {
      throw new Error(wrongNetworkMessage(expectedNetwork, activeNetwork));
    }
    if (!isConnected) {
      const allowed = await stellar.requestWalletAccess();
      if (!allowed) {
        throw new Error('Freighter wallet access was denied.');
      }
    }
    return await stellar.sendPayment(
      params.destination.trim(),
      String(parseAmountInput(params.amount)!.toFixed(7)),
      params.memo.trim(),
      (params.assetCode || 'XLM').trim().toUpperCase(),
      params.assetIssuer?.trim()
    );
  }

  if (!networkMatches(activeNetwork, expectedNetwork)) {
    throw new Error(wrongNetworkMessage(expectedNetwork, activeNetwork));
  }

  const stellar = await import('./stellar.ts');
  return await stellar.sendPayment(
    params.destination.trim(),
    String(parseAmountInput(params.amount)!.toFixed(7)),
    params.memo.trim(),
    (params.assetCode || 'XLM').trim().toUpperCase(),
    params.assetIssuer?.trim()
  );
}
