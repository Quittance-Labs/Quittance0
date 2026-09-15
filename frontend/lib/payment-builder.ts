/**
 * Dedicated Freighter payment transaction builder and validation pipeline (Issue #453).
 *
 * Enforces strict destination, amount, asset, fee, and memo safety before prompting
 * wallet signatures, produces human-readable review summaries, and classifies errors
 * distinguishing transport outages from verification rejections.
 */

import * as StellarSdk from '@stellar/stellar-sdk';
import { parseAmountInput } from './parse-amount-input.ts';
import {
  EXPECTED_WALLET_NETWORK,
  NETWORK_PASSPHRASE,
  STELLAR_NETWORK,
  checkWalletConnection,
  getFreighterNetwork,
  loadAccount,
  requestWalletAccess,
  server,
} from './stellar.ts';
import { networkMatches, networkLabel, wrongNetworkMessage, FREIGHTER_REQUIRED_MESSAGE, FREIGHTER_CONNECT_REQUIRED_MESSAGE } from './freighter-availability.js';
import { formatAddress } from './utils.ts';
import { isHorizonOutageError, HORIZON_OUTAGE_MESSAGE } from './horizon-outage.js';

export const BASE_FEE_STROOPS = '100';
export const BASE_FEE_XLM = '0.00001';
export const STELLAR_PUBKEY_REGEX = /^G[A-Z2-7]{55}$/;
export const ASSET_CODE_REGEX = /^[A-Za-z0-9]{1,12}$/;
export const MAX_MEMO_BYTES = 28;

export interface PaymentBuilderParams {
  destination: string;
  amount: string | number;
  memo: string;
  assetCode?: string;
  assetIssuer?: string;
  invoiceMemo?: string;
}

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

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

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

export interface ClassifiedPaymentError {
  type: PaymentErrorType;
  message: string;
  retryable: boolean;
  rawError?: unknown;
}

/**
 * Validates a Stellar account public key format.
 */
export function isValidStellarPublicKey(key: unknown): boolean {
  if (typeof key !== 'string') return false;
  const trimmed = key.trim();
  return STELLAR_PUBKEY_REGEX.test(trimmed);
}

/**
 * Computes byte length of a string in UTF-8.
 */
export function getUtf8ByteLength(str: string): number {
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(str).length;
  }
  return Buffer.byteLength(str, 'utf8');
}

/**
 * Pre-flight validation for payment invoice parameters before touching wallet.
 */
export function validatePaymentInvoice(params: PaymentBuilderParams): ValidationResult {
  if (!params) {
    return { valid: false, error: 'Payment parameters are required.' };
  }

  // 1. Destination validation
  if (!params.destination || !params.destination.trim()) {
    return { valid: false, error: 'Recipient destination address is required.' };
  }
  const destination = params.destination.trim();
  if (!isValidStellarPublicKey(destination)) {
    return { valid: false, error: 'Recipient destination must be a valid 56-character Stellar public key (starting with G).' };
  }

  // 2. Amount validation
  if (params.amount === undefined || params.amount === null || String(params.amount).trim() === '') {
    return { valid: false, error: 'Payment amount is required.' };
  }
  const parsedAmount = parseAmountInput(params.amount);
  if (parsedAmount === null || parsedAmount <= 0) {
    return { valid: false, error: 'Payment amount must be a positive number with at most 7 decimal places.' };
  }

  // 3. Memo validation & safety check
  if (!params.memo || typeof params.memo !== 'string' || !params.memo.trim()) {
    return { valid: false, error: 'Invoice payment memo is required.' };
  }
  const memo = params.memo.trim();
  if (getUtf8ByteLength(memo) > MAX_MEMO_BYTES) {
    return { valid: false, error: `Payment memo exceeds maximum length of ${MAX_MEMO_BYTES} UTF-8 bytes.` };
  }
  if (params.invoiceMemo !== undefined && params.invoiceMemo !== null) {
    const expectedMemo = String(params.invoiceMemo).trim();
    if (memo !== expectedMemo) {
      return { valid: false, error: `Payment memo does not match invoice memo "${expectedMemo}".` };
    }
  }

  // 4. Asset validation
  const assetCode = (params.assetCode || 'XLM').trim().toUpperCase();
  if (!ASSET_CODE_REGEX.test(assetCode)) {
    return { valid: false, error: 'Asset code must be between 1 and 12 alphanumeric characters.' };
  }
  if (assetCode !== 'XLM') {
    if (!params.assetIssuer || !isValidStellarPublicKey(params.assetIssuer)) {
      return { valid: false, error: `Asset issuer public key is required for non-XLM asset ${assetCode}.` };
    }
  }

  return { valid: true };
}

/**
 * Builds a human-readable payment review summary.
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
  const network = currentNetwork ? networkLabel(currentNetwork) : networkLabel(EXPECTED_WALLET_NETWORK);

  return {
    destination,
    shortDestination: formatAddress(destination, 6),
    amount: parsedAmount.toFixed(7),
    numericAmount: parsedAmount,
    assetCode,
    assetIssuer: assetCode !== 'XLM' ? params.assetIssuer?.trim() : undefined,
    memo,
    network,
    expectedNetwork: networkLabel(EXPECTED_WALLET_NETWORK),
    fee: BASE_FEE_XLM,
  };
}

/**
 * Classifies errors into typed buckets to distinguish transport/Horizon outage
 * problems from verification rejections and user cancellations.
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

  // Network mismatch
  if (lower.includes('wrong network') || lower.includes('switch freighter to')) {
    return {
      type: 'NETWORK_MISMATCH',
      message: msg,
      retryable: true,
      rawError: error,
    };
  }

  // Wallet connection / install
  if (lower.includes('install freighter') || lower.includes('not installed') || lower.includes('connect freighter')) {
    return {
      type: 'WALLET_REQUIRED',
      message: msg,
      retryable: true,
      rawError: error,
    };
  }

  // User rejection
  if (lower.includes('user declined') || lower.includes('denied') || lower.includes('cancelled') || lower.includes('rejected by user')) {
    return {
      type: 'WALLET_REJECTED',
      message: 'Payment was cancelled in Freighter.',
      retryable: true,
      rawError: error,
    };
  }

  // Trustline missing
  if (lower.includes('trustline') || lower.includes('op_no_trust')) {
    return {
      type: 'TRUSTLINE_REQUIRED',
      message: msg,
      retryable: true,
      rawError: error,
    };
  }

  // Account not funded
  if (lower.includes('not funded') || lower.includes('needs funding') || lower.includes('op_underfunded')) {
    return {
      type: 'ACCOUNT_UNFUNDED',
      message: msg,
      retryable: true,
      rawError: error,
    };
  }

  // Transport/network failure
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

  // Verification rejects
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
 * Builds and submits a payment transaction through Freighter with full memo safety.
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
  // 1. Strict pre-flight invoice validation
  const validation = validatePaymentInvoice(params);
  if (!validation.valid) {
    throw new Error(validation.error);
  }

  // 2. Wallet availability check
  const freighterInstalled = session?.freighterAvailable ?? (await checkWalletConnection());
  if (!freighterInstalled) {
    throw new Error(FREIGHTER_REQUIRED_MESSAGE);
  }

  // 3. Strict network gating
  const currentNetDetails = await getFreighterNetwork();
  const activeNetwork = session?.network || currentNetDetails?.networkPassphrase || currentNetDetails?.network;
  if (!networkMatches(activeNetwork, EXPECTED_WALLET_NETWORK)) {
    throw new Error(wrongNetworkMessage(EXPECTED_WALLET_NETWORK, activeNetwork));
  }

  // 4. User connection check
  if (!session?.connected) {
    const allowed = await requestWalletAccess();
    if (!allowed) {
      throw new Error('Freighter wallet access was denied.');
    }
  }

  const { sendPayment } = await import('./stellar');
  return await sendPayment(
    params.destination.trim(),
    String(parseAmountInput(params.amount)!.toFixed(7)),
    params.memo.trim(),
    (params.assetCode || 'XLM').trim().toUpperCase(),
    params.assetIssuer?.trim()
  );
}
