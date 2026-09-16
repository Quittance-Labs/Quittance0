import type { StoredInvoice } from '../storage/invoice-storage';
import type {
  HorizonOperationLike,
  HorizonTransactionLike,
  NormalizedPaymentOperation,
} from './payment-verification';
import {
  checkTxHash,
  checkPayerInfo,
  checkInvoiceIsPayable,
  findPaymentOperation,
  amountsMatch,
  amountRejectionCode,
  transactionSettlementTime,
  resolveInvoiceAsset,
  resolvePaymentAsset,
} from './payment-verification';
import { PaymentClaimError } from '../domain/payment-attribution';
import { assetsMatch } from '../utils/asset-helpers';

export function normalizeMemo(memo: unknown): string {
  return typeof memo === 'string' ? memo : '';
}
import {
  SettlementTimeUnavailableError,
  parseSettlementTime,
} from '../domain/invoice-settlement';
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

/**
 * Common shape returned by each verification pipeline stage.
 */
export type StageResult<T = void> =
  | { ok: true; stage: VerificationStage; value: T }
  | {
      ok: false;
      stage: VerificationStage;
      code: VerificationCode;
      error: string;
      details?: Record<string, unknown>;
    };

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
  transaction?: HorizonTransactionLike;
  operation: NormalizedPaymentOperation;
  operations: HorizonOperationLike[];
  settledAt?: Date;
  memo: string;
}

export interface MatchDestinationStageInput {
  operation: NormalizedPaymentOperation | HorizonOperationLike;
  expectedDestination: string;
}

export interface MatchDestinationOutput {
  destination: string;
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
    payer?: { payerName?: string; payerEmail?: string },
    opts?: { settledAt?: Date }
  ): Promise<StoredInvoice>;
  getInvoiceById?(id: string): Promise<StoredInvoice | null>;
}

export interface PersistPaidStageInput {
  invoiceId: string;
  invoiceStatus: string;
  storage: PersistPaidStorage;
  txHash: string;
  from?: string;
  payer?: {
    payerName?: string;
    payerEmail?: string;
  };
  settledAt?: Date;
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
  onBeforePersist?: (ctx?: {
    invoiceId: string;
    txHash: string;
    from?: string;
  }) => Promise<void> | void;
  onAfterPersist?: (context: { invoice: StoredInvoice; txHash: string }) => Promise<void>;
}

export type VerificationPipelineSuccess = {
  ok: true;
  stage: 'persist_paid';
  invoice: StoredInvoice;
  txHash?: string;
  from?: string;
  settledAt?: Date;
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
 * Stage 1: Fetch and normalize transaction and payment operations from Horizon.
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

  if (
    input.expectedNetwork &&
    input.network &&
    input.expectedNetwork !== input.network
  ) {
    return {
      ok: false,
      stage: 'fetch_transaction',
      code: 'NETWORK_MISMATCH',
      error: messageForCode('NETWORK_MISMATCH'),
    };
  }

  let transaction = input.transaction;
  let operations = input.operations;

  if (!transaction || !operations) {
    if (!input.stellar) {
      return {
        ok: false,
        stage: 'fetch_transaction',
        code: 'TRANSACTION_NOT_FOUND',
        error: messageForCode('TRANSACTION_NOT_FOUND'),
      };
    }

    try {
      const fetched = await input.stellar.getTransaction(txHash);
      transaction = fetched.transaction;
      operations = fetched.operations;
    } catch (err: any) {
      if (err?.code === 'TRANSACTION_NOT_FOUND' || err?.response?.status === 404 || err?.status === 404) {
        return {
          ok: false,
          stage: 'fetch_transaction',
          code: 'TRANSACTION_NOT_FOUND',
          error: messageForCode('TRANSACTION_NOT_FOUND'),
        };
      }
      if (err?.code === 'VERIFY_RATE_LIMIT_EXCEEDED' || err?.response?.status === 429 || err?.status === 429) {
        return {
          ok: false,
          stage: 'fetch_transaction',
          code: 'VERIFY_RATE_LIMIT_EXCEEDED',
          error: messageForCode('VERIFY_RATE_LIMIT_EXCEEDED'),
        };
      }
      return {
        ok: false,
        stage: 'fetch_transaction',
        code: 'TRANSACTION_NOT_FOUND',
        error: err?.message || messageForCode('TRANSACTION_NOT_FOUND'),
      };
    }
  }

  const paymentOp = findPaymentOperation(operations, input.expectedDestination);
  if (!paymentOp) {
    return {
      ok: false,
      stage: 'fetch_transaction',
      code: 'NO_PAYMENT_OPERATION',
      error: messageForCode('NO_PAYMENT_OPERATION'),
    };
  }

  const settledAt =
    transactionSettlementTime(transaction) ??
    parseSettlementTime(transaction?.created_at) ??
    undefined;

  return {
    ok: true,
    stage: 'fetch_transaction',
    value: {
      txHash,
      transaction,
      operation: paymentOp,
      operations,
      settledAt,
      memo: normalizeMemo(transaction?.memo),
    },
  };
}

/**
 * Stage 2: Verify payment destination matches the seller public key.
 */
export function matchDestinationStage(
  input: MatchDestinationStageInput
): StageResult<MatchDestinationOutput> {
  const actualDestination = (input.operation as any).to ?? '';
  if (actualDestination !== input.expectedDestination) {
    return {
      ok: false,
      stage: 'match_destination',
      code: 'DESTINATION_MISMATCH',
      error: messageForCode('DESTINATION_MISMATCH'),
      details: {
        expected: input.expectedDestination,
        actual: actualDestination,
      },
    };
  }

  return {
    ok: true,
    stage: 'match_destination',
    value: {
      destination: actualDestination,
    },
  };
}

/**
 * Stage 3: Verify asset matches the invoice asset code and issuer.
 */
export function matchAssetStage(
  input: MatchAssetStageInput
): StageResult<MatchAssetOutput> {
  const op = input.operation as any;
  const actualAssetType = op.assetType ?? op.asset_type ?? 'native';
  const actualAssetCode = op.assetCode ?? op.asset_code;
  const actualAssetIssuer = op.assetIssuer ?? op.asset_issuer;

  const invoiceAsset = resolveInvoiceAsset({
    assetCode: input.expectedAssetCode,
    assetIssuer: input.expectedAssetIssuer,
  });
  const paidAsset = resolvePaymentAsset({
    assetType: actualAssetType,
    assetCode: actualAssetCode,
    assetIssuer: actualAssetIssuer,
  });

  if (!assetsMatch(invoiceAsset, paidAsset)) {
    return {
      ok: false,
      stage: 'match_asset',
      code: 'ASSET_MISMATCH',
      error: messageForCode('ASSET_MISMATCH'),
      details: {
        expectedAssetCode: input.expectedAssetCode,
        expectedAssetIssuer: input.expectedAssetIssuer,
        actualAssetCode,
        actualAssetIssuer,
        actualAssetType,
      },
    };
  }

  const paidAssetCode =
    actualAssetType === 'native' ? 'XLM' : actualAssetCode ?? '';

  return {
    ok: true,
    stage: 'match_asset',
    value: {
      assetCode: paidAssetCode,
      assetIssuer:
        actualAssetType === 'native'
          ? undefined
          : actualAssetIssuer,
    },
  };
}

/**
 * Stage 4: Verify payment amount matches expected invoice amount.
 */
export function matchAmountStage(
  input: MatchAmountStageInput
): StageResult<MatchAmountOutput> {
  if (!amountsMatch(input.operation.amount, input.expectedAmount)) {
    const code = amountRejectionCode(
      input.operation.amount,
      input.expectedAmount
    );
    return {
      ok: false,
      stage: 'match_amount',
      code,
      error: messageForCode(code),
      details: {
        expected: String(input.expectedAmount),
        actual: input.operation.amount,
      },
    };
  }

  return {
    ok: true,
    stage: 'match_amount',
    value: {
      amount: input.operation.amount || '',
      expectedAmount: input.expectedAmount,
    },
  };
}

/**
 * Stage 5: Verify transaction memo matches expected invoice memo.
 */
export function matchMemoStage(
  input: MatchMemoStageInput
): StageResult<MatchMemoOutput> {
  const actualMemo = normalizeMemo(input.transactionMemo);
  const expectedMemo = normalizeMemo(input.expectedMemo);

  if (actualMemo !== expectedMemo) {
    return {
      ok: false,
      stage: 'match_memo',
      code: 'MEMO_MISMATCH',
      error: messageForCode('MEMO_MISMATCH'),
      details: {
        expected: expectedMemo,
        actual: actualMemo,
      },
    };
  }

  return {
    ok: true,
    stage: 'match_memo',
    value: {
      memo: actualMemo,
    },
  };
}

/**
 * Stage 6: Attribute payer information and validate settlement close time availability.
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

  if (input.invoiceStatus === 'CANCELLED' && !input.settledAt) {
    return {
      ok: false,
      stage: 'attribute',
      code: 'TRANSACTION_CLOSE_TIME_UNAVAILABLE',
      error: messageForCode('TRANSACTION_CLOSE_TIME_UNAVAILABLE'),
    };
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
 * Stage 7: Persist PAID transition and handle late payment / concurrency conflicts.
 */
export async function persistPaidStage(
  input: PersistPaidStageInput
): Promise<StageResult<PersistPaidOutput>> {
  const statusCheck = checkInvoiceIsPayable(input.invoiceStatus);
  if (!statusCheck.ok && input.invoiceStatus !== 'CANCELLED') {
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
      { settledAt: input.settledAt }
    );
  } catch (err: any) {
    if (
      err instanceof PaymentClaimError ||
      err?.code === 'TX_HASH_ALREADY_USED' ||
      /already settled another invoice/i.test(err?.message || '')
    ) {
      return {
        ok: false,
        stage: 'persist_paid',
        code: 'TX_HASH_ALREADY_USED',
        error: messageForCode('TX_HASH_ALREADY_USED'),
      };
    }
    if (input.storage.getInvoiceById) {
      try {
        const latest = await input.storage.getInvoiceById(input.invoiceId);
        const latestStatus = latest && checkInvoiceIsPayable(latest.status);
        if (latestStatus && !latestStatus.ok) {
          return {
            ok: false,
            stage: 'persist_paid',
            code: latestStatus.code,
            error: latestStatus.error,
          };
        }
      } catch {
        // ignore lookup errors during fallback re-read
      }
    }
    if (/already been paid/i.test(err?.message || '')) {
      return {
        ok: false,
        stage: 'persist_paid',
        code: 'INVOICE_ALREADY_PAID',
        error: messageForCode('INVOICE_ALREADY_PAID'),
      };
    }
    if (/expired/i.test(err?.message || '')) {
      return {
        ok: false,
        stage: 'persist_paid',
        code: 'INVOICE_EXPIRED',
        error: messageForCode('INVOICE_EXPIRED'),
      };
    }
    if (err instanceof SettlementTimeUnavailableError) {
      return {
        ok: false,
        stage: 'persist_paid',
        code: 'TRANSACTION_CLOSE_TIME_UNAVAILABLE',
        error: messageForCode('TRANSACTION_CLOSE_TIME_UNAVAILABLE'),
      };
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
 * Executes the complete payment verification pipeline across all 7 ordered stages.
 *
 * Sequence:
 * 1. fetch_transaction
 * 2. match_destination
 * 3. match_asset
 * 4. match_amount
 * 5. match_memo
 * 6. attribute
 * 7. persist_paid
 *
 * Execution short-circuits immediately upon encountering any hard failure.
 */
export async function executePaymentVerificationPipeline(
  input: ExecutePipelineInput
): Promise<VerificationPipelineResult> {
  const stagesCompleted: VerificationStage[] = [];

  const payableCheck = checkInvoiceIsPayable(input.invoice.status);
  if (!payableCheck.ok && input.invoice.status !== 'CANCELLED') {
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
    transactionMemo: fetchRes.value.memo,
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
    stagesCompleted,
  };
}

export {
  VERIFICATION_STAGES,
  stageForCode,
};
