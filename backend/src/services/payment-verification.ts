/**
 * Canonical Horizon payment verification (issue #224).
 *
 * Every verify path — MVP `/api/invoices/:id/verify`, the Postgres invoice
 * controller, and `stellar.service` — routes through this module so the four
 * checks (memo, destination, amount, asset) and the network guard stay
 * identical, and so every rejection carries the same code and message.
 *
 * The module is pure: callers fetch the transaction and operations from
 * Horizon and hand them in. See README.md "Payment verification contract".
 */

import { MuxedAccount, StrKey } from '@stellar/stellar-sdk';
import {
  assetsMatch,
  formatAssetIdentity,
  resolveInvoiceAsset,
  resolvePaymentAsset,
} from '../utils/asset-helpers';
import { amountsMatch as stroopAmountsMatch } from '../utils/verify-amount-tolerance';
import { describeAmountDelta } from '../utils/safe-amount-compare';
import { parseSettlementTime } from '../domain/invoice-settlement';

import {
  messageForCode,
  VERIFICATION_CODES,
  VERIFICATION_MESSAGES,
} from '../../../shared/verification';
import type { VerificationCode } from '../../../shared/verification';
export type {
  VerificationCode,
  VerificationFailureBody,
  VerificationStage,
  StageResult,
} from '../../../shared/verification';
export {
  VERIFICATION_CHECKS,
  CHECK_REJECTION_CODES,
  VERIFICATION_STAGES,
  STAGE_REJECTION_CODES,
  VERIFICATION_MESSAGES,
  VERIFICATION_CODES,
  messageForCode,
  stageForCode,
} from '../../../shared/verification';
export {
  fetchTransactionStage,
  matchDestinationStage,
  matchAssetStage,
  matchAmountStage,
  matchMemoStage,
  attributeStage,
  persistPaidStage,
  executePaymentVerificationPipeline,
} from './payment-verification-pipeline';
export type {
  FetchTransactionStageInput,
  FetchTransactionOutput,
  MatchDestinationStageInput,
  MatchDestinationOutput,
  MatchAssetStageInput,
  MatchAssetOutput,
  MatchAmountStageInput,
  MatchAmountOutput,
  MatchMemoStageInput,
  MatchMemoOutput,
  AttributeStageInput,
  AttributeOutput,
  PersistPaidStageInput,
  PersistPaidOutput,
  PersistPaidStorage,
  ExecutePipelineInput,
  VerificationPipelineSuccess,
  VerificationPipelineFailure,
  VerificationPipelineResult,
} from './payment-verification-pipeline';

export interface VerificationFailure {
  ok: false;
  code: VerificationCode;
  error: string;
}

export interface VerificationSuccess<T> {
  ok: true;
  value: T;
}

export type VerificationResult<T> = VerificationSuccess<T> | VerificationFailure;

/** Amount precision used by Stellar (7 decimal places). */
export const STROOP_PRECISION = 7;
const MAX_PAYER_FIELD_LENGTH = 255;
const PAYER_EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TX_HASH_PATTERN = /^[0-9a-f]{64}$/i;

export function failure(code: VerificationCode): VerificationFailure {
  return { ok: false, code, error: VERIFICATION_MESSAGES[code] };
}

/** A Stellar transaction hash is 64 hexadecimal characters. */
export function isValidTxHash(txHash: unknown): boolean {
  return typeof txHash === 'string' && TX_HASH_PATTERN.test(txHash.trim());
}

/** Reject missing or malformed hashes before spending a Horizon round trip. */
export function checkTxHash(txHash: unknown): VerificationResult<string> {
  if (typeof txHash !== 'string' || txHash.trim().length === 0) {
    return failure('MISSING_TX_HASH');
  }

  const normalized = txHash.trim();
  if (!isValidTxHash(normalized)) {
    return failure('INVALID_TX_HASH');
  }

  return { ok: true, value: normalized };
}

export interface PayerInfo {
  payerName?: string;
  payerEmail?: string;
}

/** Validate and normalize the optional payer fields sent with a verify request. */
export function checkPayerInfo(input: PayerInfo | Record<string, any>): VerificationResult<PayerInfo> {
  const { payerName, payerEmail } = input ?? {};

  if (payerName !== undefined && typeof payerName !== 'string') {
    return failure('INVALID_PAYER_NAME');
  }
  if (payerEmail !== undefined && typeof payerEmail !== 'string') {
    return failure('INVALID_PAYER_EMAIL');
  }

  const normalizedPayerName = payerName?.trim() || undefined;
  const normalizedPayerEmail = payerEmail?.trim() || undefined;

  if (normalizedPayerEmail && !PAYER_EMAIL_PATTERN.test(normalizedPayerEmail)) {
    return failure('INVALID_PAYER_EMAIL');
  }
  if (
    (normalizedPayerName?.length || 0) > MAX_PAYER_FIELD_LENGTH ||
    (normalizedPayerEmail?.length || 0) > MAX_PAYER_FIELD_LENGTH
  ) {
    return failure('PAYER_INFO_TOO_LONG');
  }

  return {
    ok: true,
    value: { payerName: normalizedPayerName, payerEmail: normalizedPayerEmail },
  };
}

/** Front-door status gate; terminal cancellation settlement is handled by storage policy. */
export function checkInvoiceIsPayable(status: string): VerificationResult<null> {
  if (status === 'PAID') {
    return failure('INVOICE_ALREADY_PAID');
  }
  if (status === 'EXPIRED') {
    return failure('INVOICE_EXPIRED');
  }
  if (status !== 'PENDING') {
    return failure('INVOICE_NOT_PENDING');
  }
  return { ok: true, value: null };
}

/** What the invoice says the payment must look like. */
export interface ExpectedPayment {
  memo: string;
  amount: string | number;
  destination: string;
  assetCode: string;
  assetIssuer?: string;
  /** Network the invoice must be paid on, e.g. `TESTNET`. Server-configured. */
  network?: string;
}

export interface HorizonTransactionLike {
  memo?: string | null;
  memo_type?: string | null;
  created_at?: string | null;
}

export interface HorizonOperationLike {
  type: string;
  from?: string;
  to?: string;
  amount?: string;
  asset_type?: string;
  asset_code?: string;
  asset_issuer?: string;
  dest_amount?: string;
  dest_asset_type?: string;
  dest_asset_code?: string;
  dest_asset_issuer?: string;
  source_amount?: string;
  source_asset_type?: string;
  source_asset_code?: string;
  source_asset_issuer?: string;
}

export interface NormalizedPaymentOperation {
  type: string;
  from: string;
  to: string;
  amount: string;
  assetType: string;
  assetCode?: string;
  assetIssuer?: string;
}

/**
 * Normalizes payment-delivering Horizon operations including standard and path payments.
 *
 * @param operation - Raw Horizon operation.
 * @returns Normalized payment details, or null if operation is not a supported payment shape.
 */
export function normalizePaymentOperation(
  operation: HorizonOperationLike,
): NormalizedPaymentOperation | null {
  if (operation.type === 'payment') {
    return {
      type: 'payment',
      from: operation.from ?? '',
      to: operation.to ?? '',
      amount: operation.amount ?? '',
      assetType: operation.asset_type ?? 'native',
      assetCode: operation.asset_code,
      assetIssuer: operation.asset_issuer,
    };
  }

  if (operation.type === 'path_payment_strict_receive') {
    return {
      type: 'path_payment_strict_receive',
      from: operation.from ?? '',
      to: operation.to ?? '',
      amount: operation.amount ?? '',
      assetType: operation.asset_type ?? 'native',
      assetCode: operation.asset_code,
      assetIssuer: operation.asset_issuer,
    };
  }

  if (operation.type === 'path_payment_strict_send') {
    return {
      type: 'path_payment_strict_send',
      from: operation.from ?? '',
      to: operation.to ?? '',
      amount: operation.dest_amount ?? operation.amount ?? '',
      assetType: operation.dest_asset_type ?? operation.asset_type ?? 'native',
      assetCode: operation.dest_asset_code ?? operation.asset_code,
      assetIssuer: operation.dest_asset_issuer ?? operation.asset_issuer,
    };
  }

  return null;
}

export interface ResolvedDestination {
  /** Underlying Ed25519 account the payment lands on. */
  accountId: string;
  /** Muxed id, present only when the destination was an `M...` address. */
  muxedId?: string;
}

/**
 * Resolve a Horizon payment destination to the account it lands on.
 *
 * `G...` addresses resolve to themselves. `M...` muxed addresses decode through
 * the SDK to the base account and the muxed id — never string-sliced, since a
 * sliced `M` could hide a different underlying account. Anything else fails
 * closed (`null`) so a malformed destination can never coerce into a match.
 */
export function resolveDestinationAccount(
  destination: string | null | undefined,
): ResolvedDestination | null {
  if (!destination) return null;
  if (StrKey.isValidEd25519PublicKey(destination)) {
    return { accountId: destination };
  }
  if (!StrKey.isValidMed25519PublicKey(destination)) return null;
  try {
    const muxed = MuxedAccount.fromAddress(destination, '0');
    return { accountId: muxed.baseAccount().accountId(), muxedId: muxed.id() };
  } catch {
    return null;
  }
}

/**
 * Whether a payment operation's `to` lands on the invoice seller. A literal
 * match always counts; otherwise the operation's destination resolves through
 * muxed-account rules and the underlying `G` account is compared. The returned
 * resolution carries the muxed id for event/proof recording, or null on no
 * match — including malformed destinations, which fail closed.
 */
export function destinationMatches(
  operationTo: string,
  expectedDestination: string,
): ResolvedDestination | null {
  if (operationTo === expectedDestination) {
    return { accountId: operationTo };
  }
  const resolved = resolveDestinationAccount(operationTo);
  if (!resolved || resolved.accountId !== expectedDestination) return null;
  return resolved;
}

/**
 * The outcome of walking a transaction's operations for the invoice payment.
 *
 * A Stellar transaction can carry several operations — a `change_trust`
 * before the pay, several payments, or a fee-bump envelope's inner ops.
 * Verification must name exactly one payment rather than take the first:
 * picking the wrong op can reject a legitimate payment, and silently
 * summing or choosing between two payments to the seller would let a tx
 * settle an invoice it never unambiguously paid.
 */
export type PaymentOperationSelection =
  | { kind: 'none' }
  | { kind: 'wrong_destination'; op: NormalizedPaymentOperation }
  | { kind: 'ambiguous'; ops: NormalizedPaymentOperation[] }
  | { kind: 'ok'; op: NormalizedPaymentOperation };

/**
 * Walks a transaction's operations and selects the invoice payment.
 *
 * Non-payment operations are ignored entirely. Payments to other
 * destinations are ignored for attribution: when none reaches the
 * invoice's destination the *first* payment op is still returned so the
 * verifier can report the destination mismatch in its documented order.
 * More than one payment to the invoice destination is ambiguous and
 * fails closed — verification never sums or picks between them.
 * A muxed `M...` destination matches when its underlying account is the seller.
 *
 * @param operations - List of operations from Horizon.
 * @param destination - The invoice's seller account.
 * @returns The selection outcome; `ok` carries the unique matching op.
 */
export function selectInvoicePaymentOperation(
  operations: HorizonOperationLike[],
  destination: string,
): PaymentOperationSelection {
  const payments = (operations || [])
    .map(normalizePaymentOperation)
    .filter((op): op is NormalizedPaymentOperation => op !== null);

  if (payments.length === 0) {
    return { kind: 'none' };
  }

  const toDestination = payments.filter((op) => destinationMatches(op.to, destination) !== null);
  if (toDestination.length > 1) {
    return { kind: 'ambiguous', ops: toDestination };
  }
  if (toDestination.length === 1) {
    return { kind: 'ok', op: toDestination[0] };
  }
  return { kind: 'wrong_destination', op: payments[0] };
}

export interface VerifiedPayment {
  txHash: string;
  from: string;
  /** The on-chain destination as reported by Horizon (`G...` or `M...`). */
  to: string;
  /** Muxed id when `to` was a muxed `M...` account of the seller. */
  toMuxedId?: string;
  amount: string;
  assetCode: string;
  assetIssuer?: string;
  memo: string;
  settledAt?: Date;
}

export interface VerifyPaymentInput {
  txHash: string;
  expected: ExpectedPayment;
  transaction: HorizonTransactionLike;
  operations: HorizonOperationLike[];
  /**
   * Network the caller observed the transaction on, e.g. `TESTNET`. Clients send
   * their own network so a testnet payment cannot settle a pubnet invoice.
   * Skipped when either side is unknown.
   */
  network?: string;
}

function normalizeMemo(memo: unknown): string {
  return typeof memo === 'string' ? memo : '';
}

/**
 * Horizon reports `memo_type` as `none` | `text` | `id` | `hash` | `return`
 * (JSON responses) or the SDK's `MEMO_*` spellings in some shapes. Anything
 * unrecognised is returned lowercased so the caller can still fail closed.
 */
function normalizeMemoType(memoType: unknown): string | undefined {
  if (typeof memoType !== 'string' || memoType === '') return undefined;
  return memoType.toLowerCase().replace(/^memo_/, '');
}

export function transactionSettlementTime(transaction: HorizonTransactionLike): Date | undefined {
  return parseSettlementTime(transaction?.created_at) ?? undefined;
}

export function amountsMatch(actual: unknown, expected: string | number): boolean {
  return stroopAmountsMatch(expected, actual, 0);
}

/**
 * Which rejection code an amount that misses the invoice earns.
 *
 * The acceptance window stays at zero stroops: an invoice is paid in full or
 * it is not. Underpayment and overpayment are still different events for the
 * payer - one leaves the invoice PENDING with money already sent, the other
 * pays more than was asked - so they carry different codes and different
 * sentences instead of sharing one amount mismatch.
 *
 * The delta classification already exists at stroop precision, so this reuses
 * it rather than re-deriving the comparison. An amount that cannot be parsed
 * stays on the generic code.
 */
export function amountRejectionCode(
  actual: unknown,
  expected: string | number
): VerificationCode {
  const delta = describeAmountDelta(expected, actual);
  if (delta.status === 'underpaid') return 'AMOUNT_TOO_LOW';
  if (delta.status === 'overpaid') return 'AMOUNT_TOO_HIGH';
  return 'AMOUNT_MISMATCH';
}

/**
 * Verify a Horizon transaction against what an invoice expects.
 *
 * Checks run in a fixed order so every caller reports the same first failure:
 * tx hash, network, payment operation, memo, destination, amount, asset.
 */
export function verifyHorizonPayment(input: VerifyPaymentInput): VerificationResult<VerifiedPayment> {
  const hashCheck = checkTxHash(input.txHash);
  if (!hashCheck.ok) {
    return hashCheck;
  }

  const { expected, transaction, operations, network } = input;

  if (expected.network && network && expected.network !== network) {
    return failure('NETWORK_MISMATCH');
  }

  const selection = selectInvoicePaymentOperation(operations, expected.destination);

  if (selection.kind === 'none') {
    return failure('NO_PAYMENT_OPERATION');
  }
  if (selection.kind === 'ambiguous') {
    return failure('AMBIGUOUS_PAYMENT_OPERATION');
  }

  const paymentOp = selection.op;

  // Invoice memos are Stellar text memos. A hash, id or return memo is never
  // coerced into the string comparison: it is rejected outright so a payer
  // cannot satisfy the memo check with bytes that were never text.
  const txMemoType = normalizeMemoType(transaction?.memo_type);
  if (txMemoType && txMemoType !== 'text' && txMemoType !== 'none') {
    return failure('MEMO_TYPE_MISMATCH');
  }

  if (normalizeMemo(transaction?.memo) !== normalizeMemo(expected.memo)) {
    return failure('MEMO_MISMATCH');
  }

  // Muxed `M...` destinations settle when the underlying `G` account is the
  // invoice seller; anything else — including malformed muxed strings — fails
  // closed here.
  const destinationResolution = destinationMatches(paymentOp.to, expected.destination);
  if (!destinationResolution) {
    return failure('DESTINATION_MISMATCH');
  }

  if (!amountsMatch(paymentOp.amount, expected.amount)) {
    return failure(amountRejectionCode(paymentOp.amount, expected.amount));
  }

  const invoiceAsset = resolveInvoiceAsset({
    assetCode: expected.assetCode,
    assetIssuer: expected.assetIssuer,
  });
  const paidAsset = resolvePaymentAsset({
    assetType: paymentOp.assetType,
    assetCode: paymentOp.assetCode,
    assetIssuer: paymentOp.assetIssuer,
  });

  if (!assetsMatch(invoiceAsset, paidAsset)) {
    return failure('ASSET_MISMATCH');
  }

  const paidAssetCode = paymentOp.assetType === 'native' ? 'XLM' : paymentOp.assetCode ?? '';
  const settledAt = transactionSettlementTime(transaction);

  return {
    ok: true,
    value: {
      txHash: hashCheck.value,
      from: paymentOp.from,
      to: paymentOp.to,
      ...(destinationResolution.muxedId ? { toMuxedId: destinationResolution.muxedId } : {}),
      amount: paymentOp.amount,
      assetCode: paidAssetCode,
      assetIssuer: paymentOp.assetType === 'native' ? undefined : paymentOp.assetIssuer,
      memo: normalizeMemo(transaction?.memo),
      ...(settledAt ? { settledAt } : {}),
    },
  };
}

export { formatAssetIdentity, resolveInvoiceAsset, resolvePaymentAsset };

export default {
  VERIFICATION_MESSAGES,
  VERIFICATION_CODES,
  messageForCode,
  failure,
  isValidTxHash,
  checkTxHash,
  checkPayerInfo,
  checkInvoiceIsPayable,
  transactionSettlementTime,
  verifyHorizonPayment,
};
