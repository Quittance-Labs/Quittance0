/**
 * Freighter invoice-payment transaction builder (issue #453).
 *
 * This is the single authoritative path for constructing a Stellar payment
 * transaction from an invoice. All validation — destination, amount, asset,
 * memo, network — must pass before a transaction is produced. The builder
 * never calls Freighter; it only builds the XDR-ready transaction. Freighter
 * signing and submission live in sendInvoicePayment().
 *
 * Design principles:
 *   - Hard failure over silent coercion. A bad input is an error, not a
 *     correctable approximation.
 *   - No trust in caller-supplied asset/issuer for USDC. The authoritative
 *     issuer comes from the shared asset registry, not from the UI field.
 *   - Network mismatch blocks construction before any Freighter prompt.
 *   - Memo is a security/business rule: missing or wrong memo = rejected.
 *   - Fee and amount are always kept separate; the payment operation receives
 *     only the invoice amount.
 */

import * as StellarSdk from '@stellar/stellar-sdk';
import { signTransaction } from '@stellar/freighter-api';
import {
  NETWORK_PASSPHRASE,
  EXPECTED_WALLET_NETWORK,
  server,
  assertFreighterReady,
  isValidPublicKey,
  loadAccount,
} from '@/lib/stellar';
import { getAssetByCode } from '@/lib/assets';
import { networkMatches } from '@/lib/freighter-availability';
import type { FreighterSession } from '@/lib/stellar';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum byte length of a Stellar text memo (Stellar SDK enforces this too). */
const MEMO_TEXT_MAX_BYTES = 28;

/** Timeout in seconds for the constructed transaction. */
const TX_TIMEOUT_SECONDS = 180;

// ---------------------------------------------------------------------------
// Error categories
// ---------------------------------------------------------------------------

/**
 * Structured error type produced by the builder and submission helpers.
 *
 * `category` distinguishes wallet/transport problems from invoice verification
 * rejects so the pay page can present them with different wording and UX.
 */
export type PaymentErrorCategory =
  | 'validation'    // invoice field is invalid — block before Freighter
  | 'network'       // wallet/session is on the wrong Stellar network
  | 'prerequisites' // a required value is missing (wallet, config)
  | 'wallet'        // Freighter unavailable, not connected, rejected by user
  | 'transport'     // submission/RPC failure after signing
  | 'verification'; // the submitted transaction failed invoice verification

export interface InvoicePaymentError {
  category: PaymentErrorCategory;
  code: string;
  message: string;
  /** The underlying error, if one was caught. */
  cause?: unknown;
}

export function makePaymentError(
  category: PaymentErrorCategory,
  code: string,
  message: string,
  cause?: unknown
): InvoicePaymentError {
  return { category, code, message, cause };
}

// ---------------------------------------------------------------------------
// Input / output types
// ---------------------------------------------------------------------------

/**
 * The minimum invoice fields the builder needs.
 * Mirrors PayPageInvoice but kept narrow to make the builder testable without
 * a full invoice fixture.
 */
export interface BuilderInvoice {
  sellerPublicKey: string;
  amount: number | string;
  assetCode: string;
  /** Required for credit assets (USDC etc.). */
  assetIssuer?: string;
  /** Required memo that must appear on the Stellar transaction. */
  memo: string;
}

export interface BuilderSession {
  /** The payer's Freighter public key. */
  publicKey: string;
  /** Freighter's reported network name (e.g. 'TESTNET'). */
  network: string | null;
  /** Freighter's reported network passphrase. */
  networkPassphrase?: string | null;
}

/**
 * A successfully built transaction, ready to hand to Freighter for signing.
 */
export interface BuiltPayment {
  /** The unsigned transaction XDR. */
  xdr: string;
  /**
   * A human-readable summary to show the user before the signing prompt.
   * All values here correspond exactly to the transaction being signed.
   */
  review: {
    /** Shortened destination for display only (actual tx uses the full key). */
    displayDestination: string;
    /** Full destination address used in the transaction. */
    destination: string;
    amount: string;
    assetCode: string;
    memo: string;
  };
  /**
   * The raw StellarSdk.Transaction, available for programmatic inspection
   * in tests. The XDR above is the serialized form of this.
   */
  transaction: StellarSdk.Transaction;
}

/**
 * The result of a successful Freighter signing + submission cycle.
 */
export interface SubmittedPayment {
  txHash: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Encode memo as UTF-8 and measure byte length.
 * Stellar text memos are limited to 28 bytes, not 28 characters.
 */
function memoByteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

/**
 * Shorten a Stellar address to the first/last 4 characters for display.
 * The actual transaction always uses the complete address.
 */
export function shortenAddress(address: string, chars = 4): string {
  if (address.length <= chars * 2 + 3) return address;
  return `${address.slice(0, chars)}...${address.slice(-chars)}`;
}

/**
 * Resolve the authoritative Stellar asset for a given code/issuer pair.
 *
 * For XLM we return the native asset directly. For credit assets the issuer
 * in the shared registry (for the app network) takes precedence over anything
 * supplied by the caller: this prevents an accidental or malicious UI field
 * from redirecting funds to a different issuer. The caller-supplied issuer is
 * only used as a fallback when the registry does not recognise the code, and
 * it is validated before use.
 */
function resolveAsset(
  assetCode: string,
  callerIssuer?: string
): { asset: StellarSdk.Asset; resolvedIssuer?: string } | InvoicePaymentError {
  const code = (assetCode || '').trim().toUpperCase();

  if (!code) {
    return makePaymentError('validation', 'MISSING_ASSET', 'Invoice asset is missing.');
  }

  if (code === 'XLM') {
    return { asset: StellarSdk.Asset.native() };
  }

  // Look up the authoritative issuer from the shared registry first.
  const known = getAssetByCode(code, EXPECTED_WALLET_NETWORK);
  const issuer = known?.issuer ?? callerIssuer;

  if (!issuer) {
    return makePaymentError(
      'prerequisites',
      'MISSING_ASSET_ISSUER',
      `No issuer configured for ${code}. The asset cannot be used for payment.`
    );
  }

  // Validate the issuer looks like a Stellar public key.
  try {
    StellarSdk.Keypair.fromPublicKey(issuer);
  } catch {
    return makePaymentError(
      'validation',
      'INVALID_ASSET_ISSUER',
      `The configured issuer for ${code} is not a valid Stellar address.`
    );
  }

  return { asset: new StellarSdk.Asset(code, issuer), resolvedIssuer: issuer };
}

/**
 * Read the result string from a Freighter sign response.
 * Freighter v2 returns either a bare string or { signedTxXdr }.
 */
function readSignedXdr(value: unknown): string | null {
  if (typeof value === 'string') return value || null;
  const v = value as Record<string, unknown>;
  if (v?.error) return null;
  if (typeof v?.signedTxXdr === 'string') return v.signedTxXdr || null;
  return null;
}

// ---------------------------------------------------------------------------
// Core builder
// ---------------------------------------------------------------------------

/**
 * Validate all invoice payment inputs and construct the Stellar transaction.
 *
 * Returns either a `BuiltPayment` ready for Freighter or an `InvoicePaymentError`
 * describing exactly what was wrong. Network mismatch, memo problems, invalid
 * destination, and bad amounts are all caught here — before Freighter is ever
 * opened.
 *
 * @param invoice  The invoice whose payment is being constructed.
 * @param session  The active Freighter wallet session.
 * @returns BuiltPayment on success, InvoicePaymentError on failure.
 */
export async function buildInvoicePayment(
  invoice: BuilderInvoice,
  session: BuilderSession
): Promise<BuiltPayment | InvoicePaymentError> {
  // ── 1. Session prerequisites ─────────────────────────────────────────────

  if (!session?.publicKey) {
    return makePaymentError(
      'prerequisites',
      'MISSING_PUBLIC_KEY',
      'Wallet is not connected. Please connect Freighter and try again.'
    );
  }

  // ── 2. Network validation (blocks before construction) ───────────────────

  if (!session.network) {
    return makePaymentError(
      'network',
      'MISSING_NETWORK',
      'Freighter has not reported a network. Please reconnect and try again.'
    );
  }

  if (!networkMatches(session.network, EXPECTED_WALLET_NETWORK)) {
    return makePaymentError(
      'network',
      'NETWORK_MISMATCH',
      `Your wallet is connected to ${session.network}, but this app requires ${EXPECTED_WALLET_NETWORK}. Switch networks in Freighter and try again.`
    );
  }

  // ── 3. Destination validation ─────────────────────────────────────────────

  if (!invoice.sellerPublicKey) {
    return makePaymentError(
      'validation',
      'MISSING_DESTINATION',
      'Invoice destination is missing.'
    );
  }

  if (!isValidPublicKey(invoice.sellerPublicKey)) {
    return makePaymentError(
      'validation',
      'INVALID_DESTINATION',
      'Invoice destination is not a valid Stellar address.'
    );
  }

  // ── 4. Amount validation ──────────────────────────────────────────────────

  if (invoice.amount === undefined || invoice.amount === null || invoice.amount === '') {
    return makePaymentError('validation', 'MISSING_AMOUNT', 'Invoice amount is missing.');
  }

  const amountNum = typeof invoice.amount === 'string'
    ? parseFloat(invoice.amount)
    : invoice.amount;

  if (!Number.isFinite(amountNum) || isNaN(amountNum)) {
    return makePaymentError(
      'validation',
      'INVALID_AMOUNT',
      'Invoice amount is not a valid number.'
    );
  }

  if (amountNum <= 0) {
    return makePaymentError(
      'validation',
      'NON_POSITIVE_AMOUNT',
      'Invoice amount must be greater than zero.'
    );
  }

  // Stellar amounts use up to 7 decimal places (stroops). Format exactly to
  // preserve the invoice amount without introducing rounding errors.
  // toFixed(7) then trimming trailing zeros still keeps 7-decimal precision.
  const amountStr = amountNum.toFixed(7).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');

  // Guard against formatting producing a different numeric value.
  if (Math.abs(parseFloat(amountStr) - amountNum) > 1e-10) {
    return makePaymentError(
      'validation',
      'AMOUNT_CONVERSION_ERROR',
      'Invoice amount could not be represented exactly as a Stellar amount.'
    );
  }

  // ── 5. Asset validation ───────────────────────────────────────────────────

  const assetResult = resolveAsset(invoice.assetCode, invoice.assetIssuer);
  if ('category' in assetResult) return assetResult;
  const { asset } = assetResult;

  // ── 6. Memo validation (hard security rule) ───────────────────────────────

  if (!invoice.memo || typeof invoice.memo !== 'string' || invoice.memo.trim() === '') {
    return makePaymentError(
      'validation',
      'MISSING_MEMO',
      'This invoice requires a memo. The payment cannot continue without the required memo.'
    );
  }

  const memoValue = invoice.memo; // Do NOT trim — preserve the exact invoice value.

  const memoBytes = memoByteLength(memoValue);
  if (memoBytes > MEMO_TEXT_MAX_BYTES) {
    return makePaymentError(
      'validation',
      'MEMO_TOO_LONG',
      `Invoice memo is ${memoBytes} bytes but Stellar text memos are limited to ${MEMO_TEXT_MAX_BYTES} bytes.`
    );
  }

  // ── 7. Load source account ────────────────────────────────────────────────

  let account: StellarSdk.Horizon.AccountResponse;
  try {
    account = await loadAccount(session.publicKey);
  } catch (err: unknown) {
    const error = err as { message?: string; response?: { status?: number } };
    if (
      error?.message?.includes('Not Found') ||
      error?.response?.status === 404
    ) {
      return makePaymentError(
        'prerequisites',
        'ACCOUNT_NOT_FOUND',
        'Your wallet account is not funded on this Stellar network. Please add funds before paying.',
        err
      );
    }
    return makePaymentError(
      'transport',
      'ACCOUNT_LOAD_FAILED',
      'Could not load your account from the Stellar network. Please try again.',
      err
    );
  }

  // ── 8. Trustline check for credit assets ─────────────────────────────────

  if (asset.getAssetType() !== 'native') {
    const issuerStr = asset.getIssuer();
    const codeStr = asset.getCode();
    const hasTrustline = account.balances.some(
      (b: StellarSdk.Horizon.HorizonApi.BalanceLine) =>
        b.asset_type !== 'native' &&
        (b as StellarSdk.Horizon.HorizonApi.BalanceLineAsset).asset_code === codeStr &&
        (b as StellarSdk.Horizon.HorizonApi.BalanceLineAsset).asset_issuer === issuerStr
    );

    if (!hasTrustline) {
      return makePaymentError(
        'prerequisites',
        'MISSING_TRUSTLINE',
        `Your wallet does not have a ${codeStr} trustline. Add the trustline in Freighter before paying.`
      );
    }
  }

  // ── 9. Build transaction ──────────────────────────────────────────────────
  //
  // Fee is kept separate from the payment amount. The payment operation
  // receives exactly the invoice amount; the fee is added as a transaction
  // attribute only.

  const transaction = new StellarSdk.TransactionBuilder(account, {
    fee: StellarSdk.BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      StellarSdk.Operation.payment({
        destination: invoice.sellerPublicKey,
        asset,
        amount: amountStr,
      })
    )
    .addMemo(StellarSdk.Memo.text(memoValue))
    .setTimeout(TX_TIMEOUT_SECONDS)
    .build();

  return {
    xdr: transaction.toXDR(),
    transaction,
    review: {
      displayDestination: shortenAddress(invoice.sellerPublicKey),
      destination: invoice.sellerPublicKey,
      amount: amountStr,
      assetCode: asset.getAssetType() === 'native' ? 'XLM' : asset.getCode(),
      memo: memoValue,
    },
  };
}

// ---------------------------------------------------------------------------
// Freighter submission
// ---------------------------------------------------------------------------

/**
 * Sign and submit a built payment transaction via Freighter.
 *
 * Expects a `BuiltPayment` from `buildInvoicePayment`. Returns the transaction
 * hash on success or a structured `InvoicePaymentError` on failure. The hash
 * returned here is the hash of the transaction that was actually submitted —
 * it must be passed directly to invoice verification.
 *
 * Error categories:
 *   - `wallet`:    user rejection, Freighter unavailable, signing failure
 *   - `transport`: submission to Horizon failed
 */
export async function submitBuiltPayment(
  built: BuiltPayment
): Promise<SubmittedPayment | InvoicePaymentError> {
  // Sign via Freighter.
  let signedTxXdr: string;
  try {
    const signResult = await signTransaction(built.xdr, {
      networkPassphrase: NETWORK_PASSPHRASE,
    });
    const xdr = readSignedXdr(signResult);
    if (!xdr) {
      return makePaymentError(
        'wallet',
        'SIGN_REJECTED',
        'Freighter did not return a signed transaction. The payment was not submitted.'
      );
    }
    signedTxXdr = xdr;
  } catch (err: unknown) {
    const error = err as { message?: string };
    const msg = error?.message ?? '';
    // User declined the signing prompt.
    if (
      msg.toLowerCase().includes('user declined') ||
      msg.toLowerCase().includes('user rejected') ||
      msg.toLowerCase().includes('transaction rejected') ||
      msg.toLowerCase().includes('cancelled')
    ) {
      return makePaymentError(
        'wallet',
        'USER_REJECTED',
        'Payment was cancelled. The transaction was not submitted.',
        err
      );
    }
    return makePaymentError(
      'wallet',
      'SIGN_FAILED',
      'Freighter could not sign the transaction. Please reconnect and try again.',
      err
    );
  }

  // Parse and submit.
  let signedTx: StellarSdk.Transaction;
  try {
    signedTx = StellarSdk.TransactionBuilder.fromXDR(
      signedTxXdr,
      NETWORK_PASSPHRASE
    ) as StellarSdk.Transaction;
  } catch (err) {
    return makePaymentError(
      'transport',
      'PARSE_SIGNED_TX_FAILED',
      'The signed transaction could not be parsed. Please try again.',
      err
    );
  }

  let result: { hash: string };
  try {
    result = await server.submitTransaction(signedTx as any);
  } catch (err: unknown) {
    const error = err as { message?: string; response?: { status?: number; data?: unknown } };
    return makePaymentError(
      'transport',
      'SUBMISSION_FAILED',
      error?.message || 'The transaction could not be submitted to the Stellar network.',
      err
    );
  }

  const txHash = result?.hash;
  if (!txHash || typeof txHash !== 'string' || !/^[0-9a-f]{64}$/i.test(txHash)) {
    return makePaymentError(
      'transport',
      'MISSING_TX_HASH',
      'The transaction was submitted but no valid hash was returned. Do not retry; check your wallet history.',
      result
    );
  }

  return { txHash };
}

// ---------------------------------------------------------------------------
// Full payment flow (build + sign + submit)
// ---------------------------------------------------------------------------

/**
 * Build, sign, and submit an invoice payment in one call.
 *
 * This is the high-level entry point used by `PaymentButton`. It:
 *   1. Verifies the Freighter session is ready.
 *   2. Delegates to `buildInvoicePayment` for full transaction construction
 *      and validation (network mismatch and memo safety happen here).
 *   3. Returns the built transaction for review before signing.
 *
 * Callers that want to show a review step should call `buildInvoicePayment`
 * directly, show `built.review`, then call `submitBuiltPayment`.
 *
 * Returns:
 *   - { built }       on successful construction (for review)
 *   - InvoicePaymentError on any validation/session failure
 */
export async function prepareInvoicePayment(
  invoice: BuilderInvoice
): Promise<{ built: BuiltPayment } | InvoicePaymentError> {
  // Assert Freighter session — this is the definitive check.
  let session: FreighterSession;
  try {
    session = await assertFreighterReady();
  } catch (err: unknown) {
    const error = err as { message?: string };
    const msg = error?.message ?? '';

    if (msg.toLowerCase().includes('network') || msg.toLowerCase().includes('switch')) {
      return makePaymentError('network', 'NETWORK_MISMATCH', msg, err);
    }
    if (msg.toLowerCase().includes('connect')) {
      return makePaymentError('wallet', 'NOT_CONNECTED', msg, err);
    }
    return makePaymentError('wallet', 'FREIGHTER_UNAVAILABLE', msg || 'Freighter is not available.', err);
  }

  const built = await buildInvoicePayment(invoice, {
    publicKey: session.publicKey!,
    network: session.network,
    networkPassphrase: session.networkPassphrase,
  });

  if ('category' in built) return built;

  return { built };
}

/**
 * Classify whether an error is a wallet/transport failure or a verification
 * rejection so the UI can present them with different messaging.
 */
export function isTransportError(err: InvoicePaymentError): boolean {
  return (
    err.category === 'wallet' ||
    err.category === 'transport' ||
    err.category === 'prerequisites' ||
    err.category === 'network'
  );
}

export function isVerificationError(err: InvoicePaymentError): boolean {
  return err.category === 'verification';
}
