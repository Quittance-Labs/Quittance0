import type { StoredInvoice } from '../../src/types/invoice';
import type {
  HorizonOperationLike,
  HorizonTransactionLike,
} from '../../src/services/payment-verification';
import type {
  VerificationCode,
  VerificationStage,
} from '../../src/services/payment-verification';

export const SELLER_PUBLIC_KEY = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';
export const BUYER_PUBLIC_KEY = 'GAYF33NNNMI2Z6VNRFXQ64D4E4SF77PM46NW3ZUZEEU5X7FCHAZCMHKU';
export const OTHER_PUBLIC_KEY = 'GCKFJ3227TG52T547K6DCF542W42PP44CX444R2PP44CX444R2PP44C5';

export const VALID_TX_HASH = '2a4261f890848f037bd45bc9860d6065757f6d8389e030945b148a0e625cf7bd';
export const ALREADY_USED_TX_HASH = 'ffa806b714bea1443ded88bff1f2b472905513deded3ba0b7cbd0f797a19854c';

export function createTestInvoice(overrides: Partial<StoredInvoice> = {}): StoredInvoice {
  return {
    id: 'inv_pipeline_test_123',
    sellerPublicKey: SELLER_PUBLIC_KEY,
    amount: 25.5,
    memo: 'order-101',
    assetCode: 'USDC',
    assetIssuer: SELLER_PUBLIC_KEY,
    network: 'TESTNET',
    status: 'PENDING',
    createdAt: new Date('2026-09-01T12:00:00.000Z'),
    expiresAt: new Date('2026-09-01T13:00:00.000Z'),
    ...overrides,
  };
}

export function createTestTransaction(overrides: Partial<HorizonTransactionLike> = {}): HorizonTransactionLike {
  return {
    memo: 'order-101',
    memo_type: 'text',
    created_at: '2026-09-01T12:05:00.000Z',
    ...overrides,
  };
}

export function createTestOperation(overrides: Partial<HorizonOperationLike> = {}): HorizonOperationLike {
  return {
    type: 'payment',
    from: BUYER_PUBLIC_KEY,
    to: SELLER_PUBLIC_KEY,
    amount: '25.5000000',
    asset_type: 'credit_alphanum4',
    asset_code: 'USDC',
    asset_issuer: SELLER_PUBLIC_KEY,
    ...overrides,
  };
}

export interface PipelineStageTestCase {
  name: string;
  stageToFail?: VerificationStage;
  expectedCode?: VerificationCode;
  expectedStagesCompleted: VerificationStage[];
  invoice: StoredInvoice;
  txHash: unknown;
  transaction?: HorizonTransactionLike;
  operations?: HorizonOperationLike[];
  payer?: { payerName?: unknown; payerEmail?: unknown };
  mockStorageFail?: 'already_used' | 'already_paid';
}

export const PIPELINE_STAGE_CASES: Record<string, PipelineStageTestCase> = {
  fetchTransactionFailHash: {
    name: 'Fails at fetch_transaction stage with invalid transaction hash',
    stageToFail: 'fetch_transaction',
    expectedCode: 'INVALID_TX_HASH',
    expectedStagesCompleted: [],
    invoice: createTestInvoice(),
    txHash: 'invalid-hash-string',
  },
  fetchTransactionFailNotFound: {
    name: 'Fails at fetch_transaction stage when transaction operations are missing',
    stageToFail: 'fetch_transaction',
    expectedCode: 'NO_PAYMENT_OPERATION',
    expectedStagesCompleted: [],
    invoice: createTestInvoice(),
    txHash: VALID_TX_HASH,
    transaction: createTestTransaction(),
    operations: [],
  },
  matchDestinationFail: {
    name: 'Fails at match_destination stage when destination does not match seller',
    stageToFail: 'match_destination',
    expectedCode: 'DESTINATION_MISMATCH',
    expectedStagesCompleted: ['fetch_transaction'],
    invoice: createTestInvoice(),
    txHash: VALID_TX_HASH,
    transaction: createTestTransaction(),
    operations: [createTestOperation({ to: OTHER_PUBLIC_KEY })],
  },
  matchAssetFail: {
    name: 'Fails at match_asset stage when asset code or issuer does not match',
    stageToFail: 'match_asset',
    expectedCode: 'ASSET_MISMATCH',
    expectedStagesCompleted: ['fetch_transaction', 'match_destination'],
    invoice: createTestInvoice(),
    txHash: VALID_TX_HASH,
    transaction: createTestTransaction(),
    operations: [createTestOperation({ asset_code: 'EURC' })],
  },
  matchAmountFail: {
    name: 'Fails at match_amount stage when payment amount is below invoice amount',
    stageToFail: 'match_amount',
    expectedCode: 'AMOUNT_TOO_LOW',
    expectedStagesCompleted: ['fetch_transaction', 'match_destination', 'match_asset'],
    invoice: createTestInvoice({ amount: 50.0 }),
    txHash: VALID_TX_HASH,
    transaction: createTestTransaction(),
    operations: [createTestOperation({ amount: '25.5000000' })],
  },
  matchMemoFail: {
    name: 'Fails at match_memo stage when transaction memo does not match invoice',
    stageToFail: 'match_memo',
    expectedCode: 'MEMO_MISMATCH',
    expectedStagesCompleted: ['fetch_transaction', 'match_destination', 'match_asset', 'match_amount'],
    invoice: createTestInvoice({ memo: 'expected-memo' }),
    txHash: VALID_TX_HASH,
    transaction: createTestTransaction({ memo: 'different-memo' }),
    operations: [createTestOperation()],
  },
  attributeFail: {
    name: 'Fails at attribute stage when payer email is malformed',
    stageToFail: 'attribute',
    expectedCode: 'INVALID_PAYER_EMAIL',
    expectedStagesCompleted: ['fetch_transaction', 'match_destination', 'match_asset', 'match_amount', 'match_memo'],
    invoice: createTestInvoice(),
    txHash: VALID_TX_HASH,
    transaction: createTestTransaction(),
    operations: [createTestOperation()],
    payer: { payerEmail: 'not-an-email' },
  },
  persistPaidFail: {
    name: 'Fails at persist_paid stage when txHash was already claimed by another invoice',
    stageToFail: 'persist_paid',
    expectedCode: 'TX_HASH_ALREADY_USED',
    expectedStagesCompleted: ['fetch_transaction', 'match_destination', 'match_asset', 'match_amount', 'match_memo', 'attribute'],
    invoice: createTestInvoice(),
    txHash: ALREADY_USED_TX_HASH,
    transaction: createTestTransaction(),
    operations: [createTestOperation()],
    mockStorageFail: 'already_used',
  },
  fullSuccess: {
    name: 'Succeeds through all 7 stages and marks invoice as PAID',
    expectedStagesCompleted: [
      'fetch_transaction',
      'match_destination',
      'match_asset',
      'match_amount',
      'match_memo',
      'attribute',
      'persist_paid',
    ],
    invoice: createTestInvoice(),
    txHash: VALID_TX_HASH,
    transaction: createTestTransaction(),
    operations: [createTestOperation()],
    payer: { payerName: 'Alice', payerEmail: 'alice@example.com' },
  },
};
