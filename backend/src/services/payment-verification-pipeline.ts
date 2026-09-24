/**
 * Multi-step payment verification pipeline (issue #441).
 *
 * Manual verify and the payment monitor both enter through
 * `executePaymentVerificationPipeline` so stage order, rejection codes, and
 * the PAID transition stay identical across entry points.
 *
 * Stages run in fixed order and short-circuit on hard failure:
 * fetch_transaction → match_destination → match_asset → match_amount →
 * match_memo → attribute → persist_paid.
 */

import type { StoredInvoice, MarkAsPaidOptions, PayerInfo } from '../storage/invoice-storage';
import type {
  HorizonOperationLike,
  HorizonTransactionLike,
  NormalizedPaymentOperation,
  ResolvedDestination,
} from './payment-verification';
import {
  checkTxHash,
  checkPayerInfo,
  checkInvoiceIsPayable,
  selectInvoicePaymentOperation,
  destinationMatches,
  amountsMatch,
  amountRejectionCode,
  transactionSettlementTime,
  resolveInvoiceAsset,
  resolvePaymentAsset,
  normalizePaymentOperation,
} from './payment-verification';
import { PaymentClaimError } from '../domain/payment-attribution';
import {
  SettlementTimeUnavailableError,
} from '../domain/invoice-settlement';
import { assetsMatch } from '../utils/asset-helpers';
import { isHorizonUnavailable } from '../utils/horizon-client';
import {
  VERIFICATION_STAGES,
  messageForCode,
  stageForCode,
} from '../../../shared/verification';
import type {
  VerificationCode,
  VerificationStage,
} from '../../../shared/verification';

export type { VerificationCode, VerificationStage };

export type StageResult<T = void> =
  | { ok: true; stage: VerificationStage; value: T }
  | {
      ok: false;
      stage: VerificationStage;
      code: VerificationCode;
      error: string;
      details?: Record<string, unknown>;
    };

function stageFailure(
  stage: VerificationStage,
  code: VerificationCode,
  details?: Record<string, unknown>
): StageResult<never> {
  return {
    ok: false,
    stage,
    code,
    error: messageForCode(code),
    ...(details ? { details } : {}),
  };
}

export function normalizeMemo(memo: unknown): string {
  return typeof memo === 'string' ? memo : '';
}

function normalizeMemoType(memoType: unknown): string | undefined {
  if (typeof memoType !== 'string' || memoType === '') return undefined;
  return memoType.toLowerCase().replace(/^memo_/, '');
}

function asNormalizedOperation(
  operation: NormalizedPaymentOperation | HorizonOperationLike
): NormalizedPaymentOperation {
  if ('assetType' in operation && typeof (operation as NormalizedPaymentOperation).assetType === 'string') {
    return operation as NormalizedPaymentOperation;
  }
  const normalized = normalizePaymentOperation(operation as HorizonOperationLike);
  if (!normalized) {
    return {
      type: (operation as HorizonOperationLike).type || 'payment',
      from: (operation as HorizonOperationLike).from ?? '',
      to: (operation as HorizonOperationLike).to ?? '',
      amount: (operation as HorizonOperationLike).amount ?? '',
      assetType: (operation as HorizonOperationLike).asset_type ?? 'native',
      assetCode: (operation as HorizonOperationLike).asset_code,
      assetIssuer: (operation as HorizonOperationLike).asset_issuer,
    };
  }
  return normalized;
}

export interface FetchTransactionStageInput {
  txHash: unknown;
  network?: string;
  expectedNetwork?: string;
  transaction?: HorizonTransactionLike;
  operations?: HorizonOperationLike[];
  stellar?: {
    getTransaction(txHash: string): Promise<{
      transaction: HorizonTransactionLike;
      operations: HorizonOperationLike[];
    }>;
  };
  expectedDestination?: string;
}

export interface FetchTransactionOutput {
  txHash: string;
  transaction: HorizonTransactionLike;
  operation: NormalizedPaymentOperation;
  operations: HorizonOperationLike[];
  settledAt?: Date;
  memo: string;
  memoType?: string;
}

export interface MatchDestinationStageInput {
  operation: NormalizedPaymentOperation | HorizonOperationLike;
  expectedDestination: string;
}

export interface MatchDestinationOutput {
  destination: string;
  resolution: ResolvedDestination;
}

export interface MatchAssetStageInput {
  operation: NormalizedPaymentOperation | HorizonOperationLike;
  expectedAssetCode?: string;
  expectedAssetIssuer?: string;
}

export interface MatchAssetOutput {
  assetCode: string;
  assetIssuer?: string;
}

export interface MatchAmountStageInput {
  operation: NormalizedPaymentOperation | HorizonOperationLike;
  expectedAmount: number | string;
}

export interface MatchAmountOutput {
  amount: string;
  expectedAmount: number | string;
}

export interface MatchMemoStageInput {
  transactionMemo?: unknown;
  transactionMemoType?: unknown;
  expectedMemo: string;
}

export interface MatchMemoOutput {
  memo: string;
}

export interface AttributeStageInput {
  payer?: {
    payerName?: unknown;
    payerEmail?: unknown;
  };
  invoiceStatus?: string;
  settledAt?: Date;
  /** When true, missing close time is a hard failure (manual verify + monitor). */
  requireSettledAt?: boolean;
}

export interface AttributeOutput {
  payerName?: string;
  payerEmail?: string;
  settledAt?: Date;
}

export interface PersistPaidStorage {
  markAsPaid(
    id: string,
    txHash: string,
    payerPublicKey?: string,
    payer?: PayerInfo,
    opts?: MarkAsPaidOptions
  ): Promise<StoredInvoice>;
  getInvoiceById?(id: string): Promise<StoredInvoice | null>;
}

export interface PersistPaidStageInput {
  invoiceId: string;
  invoiceStatus: string;
  storage: PersistPaidStorage;
  txHash: string;
  from?: string;
  payer?: PayerInfo;
  settledAt?: Date;
  destinationMuxedId?: string;
  onBeforePersist?: (ctx?: {
    invoiceId: string;
    txHash: string;
    from?: string;
  }) => Promise<void> | void;
  onAfterPersist?: (ctx: {
    invoice: StoredInvoice;
    txHash: string;
  }) => Promise<void> | void;
}

export interface PersistPaidOutput {
  invoice: StoredInvoice;
  txHash?: string;
  from?: string;
  settledAt?: Date;
}

export interface ExecutePipelineInput {
  invoice: StoredInvoice;
  txHash: unknown;
  network?: string;
  expectedNetwork?: string;
  stellar?: {
    getTransaction(txHash: string): Promise<{
      transaction: HorizonTransactionLike;
      operations: HorizonOperationLike[];
    }>;
  };
  storage: PersistPaidStorage;
  transaction?: HorizonTransactionLike;
  operations?: HorizonOperationLike[];
  payer?: {
    payerName?: unknown;
    payerEmail?: unknown;
  };
  requireSettledAt?: boolean;
  onBeforePersist?: (ctx?: {
    invoiceId: string;
    txHash: string;
    from?: string;
  }) => Promise<void> | void;
  onAfterPersist?: (context: { invoice: StoredInvoice; txHash: string }) => Promise<void> | void;
}

export type VerificationPipelineSuccess = {
  ok: true;
  stage: 'persist_paid';
  invoice: StoredInvoice;
  txHash?: string;
  from?: string;
  settledAt?: Date;
  toMuxedId?: string;
  stagesCompleted: VerificationStage[];
};

export type VerificationPipelineFailure = {
  ok: false;
  stage: VerificationStage;
  code: VerificationCode;
  error: string;
  details?: Record<string, unknown>;
  stagesCompleted: VerificationStage[];
};

export type VerificationPipelineResult =
  | VerificationPipelineSuccess
  | VerificationPipelineFailure;

/**
 * Stage 1: Validate hash/network, fetch Horizon resources, select payment op.
 */
export async function fetchTransactionStage(
  input: FetchTransactionStageInput
): Promise<StageResult<FetchTransactionOutput>> {
  const hashCheck = checkTxHash(input.txHash);
  if (!hashCheck.ok) {
    return {
      ok: false,
      stage: 'fetch_transaction',
      code: hashCheck.code,
      error: hashCheck.error,
    };
  }

  const txHash = hashCheck.value;

  if (input.expectedNetwork && input.network && input.expectedNetwork !== input.network) {
    return stageFailure('fetch_transaction', 'NETWORK_MISMATCH', {
      expected: input.expectedNetwork,
      actual: input.network,
    });
  }

  let transaction = input.transaction;
  let operations = input.operations;

  if (!transaction || !operations) {
    if (!input.stellar) {
      return stageFailure('fetch_transaction', 'TRANSACTION_NOT_FOUND');
    }
    try {
      const fetched = await input.stellar.getTransaction(txHash);
      transaction = fetched.transaction;
      operations = fetched.operations;
    } catch (err: any) {
      if (isHorizonUnavailable(err)) {
        return stageFailure('fetch_transaction', 'VERIFY_UNAVAILABLE');
      }
      if (
        err?.code === 'VERIFY_RATE_LIMIT_EXCEEDED' ||
        err?.response?.status === 429 ||
        err?.status === 429
      ) {
        return stageFailure('fetch_transaction', 'VERIFY_RATE_LIMIT_EXCEEDED');
      }
      if (
        err?.code === 'TRANSACTION_NOT_FOUND' ||
        err?.response?.status === 404 ||
        err?.status === 404 ||
        /not found/i.test(err?.message || '')
      ) {
        return stageFailure('fetch_transaction', 'TRANSACTION_NOT_FOUND');
      }
      return stageFailure('fetch_transaction', 'TRANSACTION_NOT_FOUND', {
        message: err?.message,
      });
    }
  }

  const destination = input.expectedDestination || '';
  const selection = selectInvoicePaymentOperation(operations || [], destination);

  if (selection.kind === 'none') {
    return stageFailure('fetch_transaction', 'NO_PAYMENT_OPERATION');
  }
  if (selection.kind === 'ambiguous') {
    return stageFailure('fetch_transaction', 'AMBIGUOUS_PAYMENT_OPERATION');
  }

  const paymentOp = selection.op;
  const settledAt = transactionSettlementTime(transaction!);

  return {
    ok: true,
    stage: 'fetch_transaction',
    value: {
      txHash,
      transaction: transaction!,
      operation: paymentOp,
      operations: operations || [],
      settledAt,
      memo: normalizeMemo(transaction?.memo),
      memoType: normalizeMemoType(transaction?.memo_type),
    },
  };
}

/**
 * Stage 2: Payment destination must land on the invoice seller (incl. muxed).
 */
export function matchDestinationStage(
  input: MatchDestinationStageInput
): StageResult<MatchDestinationOutput> {
  const op = asNormalizedOperation(input.operation);
  const resolution = destinationMatches(op.to, input.expectedDestination);
  if (!resolution) {
    return stageFailure('match_destination', 'DESTINATION_MISMATCH', {
      expected: input.expectedDestination,
      actual: op.to,
    });
  }
  return {
    ok: true,
    stage: 'match_destination',
    value: { destination: op.to, resolution },
  };
}

/**
 * Stage 3: Asset code and issuer must match the invoice.
 */
export function matchAssetStage(
  input: MatchAssetStageInput
): StageResult<MatchAssetOutput> {
  const op = asNormalizedOperation(input.operation);
  const invoiceAsset = resolveInvoiceAsset({
    assetCode: input.expectedAssetCode,
    assetIssuer: input.expectedAssetIssuer,
  });
  const paidAsset = resolvePaymentAsset({
    assetType: op.assetType,
    assetCode: op.assetCode,
    assetIssuer: op.assetIssuer,
  });

  if (!assetsMatch(invoiceAsset, paidAsset)) {
    return stageFailure('match_asset', 'ASSET_MISMATCH', {
      expectedAssetCode: input.expectedAssetCode,
      expectedAssetIssuer: input.expectedAssetIssuer,
      actualAssetCode: op.assetCode,
      actualAssetIssuer: op.assetIssuer,
      actualAssetType: op.assetType,
    });
  }

  return {
    ok: true,
    stage: 'match_asset',
    value: {
      assetCode: op.assetType === 'native' ? 'XLM' : op.assetCode ?? '',
      assetIssuer: op.assetType === 'native' ? undefined : op.assetIssuer,
    },
  };
}

/**
 * Stage 4: Received amount must equal the invoice amount (zero-stroop window).
 */
export function matchAmountStage(
  input: MatchAmountStageInput
): StageResult<MatchAmountOutput> {
  const op = asNormalizedOperation(input.operation);
  if (!amountsMatch(op.amount, input.expectedAmount)) {
    const code = amountRejectionCode(op.amount, input.expectedAmount);
    return stageFailure('match_amount', code, {
      expected: String(input.expectedAmount),
      actual: op.amount,
    });
  }
  return {
    ok: true,
    stage: 'match_amount',
    value: { amount: op.amount || '', expectedAmount: input.expectedAmount },
  };
}

/**
 * Stage 5: Text memo must match the invoice memo.
 */
export function matchMemoStage(
  input: MatchMemoStageInput
): StageResult<MatchMemoOutput> {
  const txMemoType = normalizeMemoType(input.transactionMemoType);
  if (txMemoType && txMemoType !== 'text' && txMemoType !== 'none') {
    return stageFailure('match_memo', 'MEMO_TYPE_MISMATCH', {
      actualType: txMemoType,
    });
  }

  const actualMemo = normalizeMemo(input.transactionMemo);
  const expectedMemo = normalizeMemo(input.expectedMemo);
  if (actualMemo !== expectedMemo) {
    return stageFailure('match_memo', 'MEMO_MISMATCH', {
      expected: expectedMemo,
      actual: actualMemo,
    });
  }
  return {
    ok: true,
    stage: 'match_memo',
    value: { memo: actualMemo },
  };
}

/**
 * Stage 6: Normalize payer fields and require ledger close time when needed.
 */
export function attributeStage(
  input: AttributeStageInput
): StageResult<AttributeOutput> {
  const payerCheck = checkPayerInfo(input.payer ?? {});
  if (!payerCheck.ok) {
    return {
      ok: false,
      stage: 'attribute',
      code: payerCheck.code,
      error: payerCheck.error,
    };
  }

  const needsCloseTime =
    input.requireSettledAt === true || input.invoiceStatus === 'CANCELLED';
  if (needsCloseTime && !input.settledAt) {
    return stageFailure('attribute', 'TRANSACTION_CLOSE_TIME_UNAVAILABLE');
  }

  return {
    ok: true,
    stage: 'attribute',
    value: {
      payerName: payerCheck.value?.payerName,
      payerEmail: payerCheck.value?.payerEmail,
      settledAt: input.settledAt,
    },
  };
}

/**
 * Stage 7: Atomic PAID transition with claim / status conflict mapping.
 */
export async function persistPaidStage(
  input: PersistPaidStageInput
): Promise<StageResult<PersistPaidOutput>> {
  const statusCheck = checkInvoiceIsPayable(input.invoiceStatus);
  if (
    !statusCheck.ok &&
    input.invoiceStatus !== 'CANCELLED' &&
    input.invoiceStatus !== 'EXPIRED'
  ) {
    return {
      ok: false,
      stage: 'persist_paid',
      code: statusCheck.code,
      error: statusCheck.error,
    };
  }

  if (input.onBeforePersist) {
    await input.onBeforePersist({
      invoiceId: input.invoiceId,
      txHash: input.txHash,
      from: input.from,
    });
  }

  let updatedInvoice: StoredInvoice;
  try {
    updatedInvoice = await input.storage.markAsPaid(
      input.invoiceId,
      input.txHash,
      input.from,
      input.payer,
      {
        settledAt: input.settledAt,
        ...(input.destinationMuxedId
          ? { destinationMuxedId: input.destinationMuxedId }
          : {}),
      }
    );
  } catch (err: any) {
    if (err instanceof PaymentClaimError || err?.code === 'TX_HASH_ALREADY_USED') {
      return stageFailure('persist_paid', 'TX_HASH_ALREADY_USED');
    }
    if (err instanceof SettlementTimeUnavailableError) {
      return stageFailure('persist_paid', 'TRANSACTION_CLOSE_TIME_UNAVAILABLE');
    }
    if (input.storage.getInvoiceById) {
      try {
        const latest = await input.storage.getInvoiceById(input.invoiceId);
        const latestStatus = latest && checkInvoiceIsPayable(latest.status);
        if (
          latestStatus &&
          !latestStatus.ok &&
          latest!.status !== 'CANCELLED' &&
          latest!.status !== 'EXPIRED'
        ) {
          return {
            ok: false,
            stage: 'persist_paid',
            code: latestStatus.code,
            error: latestStatus.error,
          };
        }
      } catch {
        // ignore re-read errors
      }
    }
    if (/already been paid/i.test(err?.message || '')) {
      return stageFailure('persist_paid', 'INVOICE_ALREADY_PAID');
    }
    if (/expired/i.test(err?.message || '')) {
      return stageFailure('persist_paid', 'INVOICE_EXPIRED');
    }
    throw err;
  }

  if (input.onAfterPersist) {
    await input.onAfterPersist({ invoice: updatedInvoice, txHash: input.txHash });
  }

  return {
    ok: true,
    stage: 'persist_paid',
    value: {
      invoice: updatedInvoice,
      txHash: input.txHash,
      from: input.from,
      settledAt: input.settledAt,
    },
  };
}

/**
 * Runs the full verification pipeline with short-circuit on hard failure.
 */
export async function executePaymentVerificationPipeline(
  input: ExecutePipelineInput
): Promise<VerificationPipelineResult> {
  const stagesCompleted: VerificationStage[] = [];

  const payableCheck = checkInvoiceIsPayable(input.invoice.status);
  if (
    !payableCheck.ok &&
    input.invoice.status !== 'CANCELLED' &&
    input.invoice.status !== 'EXPIRED'
  ) {
    return {
      ok: false,
      stage: 'persist_paid',
      code: payableCheck.code,
      error: payableCheck.error,
      stagesCompleted,
    };
  }

  const fetchRes = await fetchTransactionStage({
    txHash: input.txHash,
    network: input.network,
    expectedNetwork: input.expectedNetwork,
    transaction: input.transaction,
    operations: input.operations,
    stellar: input.stellar,
    expectedDestination: input.invoice.sellerPublicKey,
  });
  if (!fetchRes.ok) {
    return {
      ok: false,
      stage: 'fetch_transaction',
      code: fetchRes.code,
      error: fetchRes.error,
      details: fetchRes.details,
      stagesCompleted,
    };
  }
  stagesCompleted.push('fetch_transaction');

  const destRes = matchDestinationStage({
    operation: fetchRes.value.operation,
    expectedDestination: input.invoice.sellerPublicKey,
  });
  if (!destRes.ok) {
    return {
      ok: false,
      stage: 'match_destination',
      code: destRes.code,
      error: destRes.error,
      details: destRes.details,
      stagesCompleted,
    };
  }
  stagesCompleted.push('match_destination');

  const assetRes = matchAssetStage({
    operation: fetchRes.value.operation,
    expectedAssetCode: input.invoice.assetCode,
    expectedAssetIssuer: input.invoice.assetIssuer,
  });
  if (!assetRes.ok) {
    return {
      ok: false,
      stage: 'match_asset',
      code: assetRes.code,
      error: assetRes.error,
      details: assetRes.details,
      stagesCompleted,
    };
  }
  stagesCompleted.push('match_asset');

  const amountRes = matchAmountStage({
    operation: fetchRes.value.operation,
    expectedAmount: input.invoice.amount,
  });
  if (!amountRes.ok) {
    return {
      ok: false,
      stage: 'match_amount',
      code: amountRes.code,
      error: amountRes.error,
      details: amountRes.details,
      stagesCompleted,
    };
  }
  stagesCompleted.push('match_amount');

  const memoRes = matchMemoStage({
    transactionMemo: fetchRes.value.transaction?.memo ?? fetchRes.value.memo,
    transactionMemoType: fetchRes.value.transaction?.memo_type ?? fetchRes.value.memoType,
    expectedMemo: input.invoice.memo,
  });
  if (!memoRes.ok) {
    return {
      ok: false,
      stage: 'match_memo',
      code: memoRes.code,
      error: memoRes.error,
      details: memoRes.details,
      stagesCompleted,
    };
  }
  stagesCompleted.push('match_memo');

  const attrRes = attributeStage({
    payer: input.payer,
    invoiceStatus: input.invoice.status,
    settledAt: fetchRes.value.settledAt,
    requireSettledAt: input.requireSettledAt !== false,
  });
  if (!attrRes.ok) {
    return {
      ok: false,
      stage: 'attribute',
      code: attrRes.code,
      error: attrRes.error,
      details: attrRes.details,
      stagesCompleted,
    };
  }
  stagesCompleted.push('attribute');

  const persistRes = await persistPaidStage({
    invoiceId: input.invoice.id,
    invoiceStatus: input.invoice.status,
    storage: input.storage,
    txHash: fetchRes.value.txHash,
    from: fetchRes.value.operation.from,
    payer: {
      payerName: attrRes.value.payerName,
      payerEmail: attrRes.value.payerEmail,
    },
    settledAt: attrRes.value.settledAt,
    destinationMuxedId: destRes.value.resolution.muxedId,
    onBeforePersist: input.onBeforePersist,
    onAfterPersist: input.onAfterPersist,
  });
  if (!persistRes.ok) {
    return {
      ok: false,
      stage: 'persist_paid',
      code: persistRes.code,
      error: persistRes.error,
      details: persistRes.details,
      stagesCompleted,
    };
  }
  stagesCompleted.push('persist_paid');

  return {
    ok: true,
    stage: 'persist_paid',
    invoice: persistRes.value.invoice,
    txHash: persistRes.value.txHash,
    from: persistRes.value.from,
    settledAt: persistRes.value.settledAt,
    toMuxedId: destRes.value.resolution.muxedId,
    stagesCompleted,
  };
}

export { VERIFICATION_STAGES, stageForCode };
