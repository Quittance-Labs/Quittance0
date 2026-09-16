import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  VERIFICATION_STAGES,
  STAGE_REJECTION_CODES,
  stageForCode,
  fetchTransactionStage,
  matchDestinationStage,
  matchAssetStage,
  matchAmountStage,
  matchMemoStage,
  attributeStage,
  persistPaidStage,
  executePaymentVerificationPipeline,
} from '../src/services/payment-verification.ts';
import type { StoredInvoice } from '../src/types/invoice.ts';
import type { PersistPaidStorage } from '../src/services/payment-verification-pipeline.ts';
import { PaymentClaimError } from '../src/domain/payment-attribution.ts';
import {
  SELLER_PUBLIC_KEY,
  BUYER_PUBLIC_KEY,
  OTHER_PUBLIC_KEY,
  VALID_TX_HASH,
  ALREADY_USED_TX_HASH,
  createTestInvoice,
  createTestTransaction,
  createTestOperation,
  PIPELINE_STAGE_CASES,
} from './fixtures/payment-verification-pipeline.fixture.ts';

function createMockStorage(options: {
  failMode?: 'already_used' | 'already_paid';
  existingInvoice?: StoredInvoice;
} = {}): PersistPaidStorage {
  const invoice = options.existingInvoice ?? createTestInvoice();
  return {
    async markAsPaid(id, txHash, payerPublicKey, payer, opts) {
      if (options.failMode === 'already_used' || txHash === ALREADY_USED_TX_HASH) {
        throw new PaymentClaimError('TX_HASH_ALREADY_USED');
      }
      if (options.failMode === 'already_paid') {
        throw new Error('Invoice has already been paid');
      }
      return {
        ...invoice,
        id,
        status: 'PAID',
        paymentTxHash: txHash,
        payerPublicKey,
        payerName: payer?.payerName,
        payerEmail: payer?.payerEmail,
        paidAt: opts?.settledAt ?? new Date(),
      };
    },
    async getInvoiceById(id) {
      return { ...invoice, id };
    },
  };
}

describe('Payment Verification Pipeline Stages', () => {
  it('defines the 7 required stages in exact execution order', () => {
    assert.deepEqual(VERIFICATION_STAGES, [
      'fetch_transaction',
      'match_destination',
      'match_asset',
      'match_amount',
      'match_memo',
      'attribute',
      'persist_paid',
    ]);
  });

  it('correctly maps verification codes to their respective pipeline stage', () => {
    for (const stage of VERIFICATION_STAGES) {
      const codes = STAGE_REJECTION_CODES[stage];
      assert.ok(codes.length > 0, `Stage ${stage} must have mapped rejection codes`);
      for (const code of codes) {
        assert.equal(stageForCode(code), stage);
      }
    }
  });

  describe('Stage 1: fetchTransactionStage', () => {
    it('fails when transaction hash is invalid', async () => {
      const res = await fetchTransactionStage({
        txHash: 'invalid-hash',
      });
      assert.equal(res.ok, false);
      assert.equal(res.stage, 'fetch_transaction');
      assert.equal(res.code, 'INVALID_TX_HASH');
    });

    it('fails when network mismatches', async () => {
      const res = await fetchTransactionStage({
        txHash: VALID_TX_HASH,
        network: 'PUBLIC',
        expectedNetwork: 'TESTNET',
        transaction: createTestTransaction(),
        operations: [createTestOperation()],
      });
      assert.equal(res.ok, false);
      assert.equal(res.stage, 'fetch_transaction');
      assert.equal(res.code, 'NETWORK_MISMATCH');
    });

    it('fails when no payment operation exists', async () => {
      const res = await fetchTransactionStage({
        txHash: VALID_TX_HASH,
        transaction: createTestTransaction(),
        operations: [{ type: 'create_account', account: BUYER_PUBLIC_KEY, starting_balance: '10' } as any],
        expectedDestination: SELLER_PUBLIC_KEY,
      });
      assert.equal(res.ok, false);
      assert.equal(res.stage, 'fetch_transaction');
      assert.equal(res.code, 'NO_PAYMENT_OPERATION');
    });

    it('succeeds when valid transaction and operations are provided', async () => {
      const op = createTestOperation();
      const res = await fetchTransactionStage({
        txHash: VALID_TX_HASH,
        transaction: createTestTransaction(),
        operations: [op],
        expectedDestination: SELLER_PUBLIC_KEY,
      });
      assert.equal(res.ok, true);
      assert.equal(res.stage, 'fetch_transaction');
      if (res.ok) {
        assert.equal(res.value.txHash, VALID_TX_HASH);
        assert.equal(res.value.operation.to, SELLER_PUBLIC_KEY);
      }
    });
  });

  describe('Stage 2: matchDestinationStage', () => {
    it('fails when destination does not match expected seller', () => {
      const op = createTestOperation({ to: OTHER_PUBLIC_KEY });
      const res = matchDestinationStage({
        operation: op as any,
        expectedDestination: SELLER_PUBLIC_KEY,
      });
      assert.equal(res.ok, false);
      assert.equal(res.stage, 'match_destination');
      assert.equal(res.code, 'DESTINATION_MISMATCH');
    });

    it('succeeds when destination matches seller', () => {
      const op = createTestOperation({ to: SELLER_PUBLIC_KEY });
      const res = matchDestinationStage({
        operation: op as any,
        expectedDestination: SELLER_PUBLIC_KEY,
      });
      assert.equal(res.ok, true);
      assert.equal(res.stage, 'match_destination');
    });
  });

  describe('Stage 3: matchAssetStage', () => {
    it('fails when asset code does not match', () => {
      const op = createTestOperation({ asset_code: 'EURC' });
      const res = matchAssetStage({
        operation: op as any,
        expectedAssetCode: 'USDC',
        expectedAssetIssuer: SELLER_PUBLIC_KEY,
      });
      assert.equal(res.ok, false);
      assert.equal(res.stage, 'match_asset');
      assert.equal(res.code, 'ASSET_MISMATCH');
    });

    it('succeeds when asset code and issuer match', () => {
      const op = createTestOperation({ asset_code: 'USDC', asset_issuer: SELLER_PUBLIC_KEY });
      const res = matchAssetStage({
        operation: op as any,
        expectedAssetCode: 'USDC',
        expectedAssetIssuer: SELLER_PUBLIC_KEY,
      });
      assert.equal(res.ok, true);
      assert.equal(res.stage, 'match_asset');
    });
  });

  describe('Stage 4: matchAmountStage', () => {
    it('fails when amount is lower than invoice amount', () => {
      const op = createTestOperation({ amount: '10.0000000' });
      const res = matchAmountStage({
        operation: op as any,
        expectedAmount: 25.5,
      });
      assert.equal(res.ok, false);
      assert.equal(res.stage, 'match_amount');
      assert.equal(res.code, 'AMOUNT_TOO_LOW');
    });

    it('succeeds when amount matches invoice amount within precision', () => {
      const op = createTestOperation({ amount: '25.5000000' });
      const res = matchAmountStage({
        operation: op as any,
        expectedAmount: 25.5,
      });
      assert.equal(res.ok, true);
      assert.equal(res.stage, 'match_amount');
    });
  });

  describe('Stage 5: matchMemoStage', () => {
    it('fails when memo does not match invoice memo', () => {
      const res = matchMemoStage({
        transactionMemo: 'incorrect-memo',
        expectedMemo: 'expected-memo',
      });
      assert.equal(res.ok, false);
      assert.equal(res.stage, 'match_memo');
      assert.equal(res.code, 'MEMO_MISMATCH');
    });

    it('succeeds when memo matches exactly', () => {
      const res = matchMemoStage({
        transactionMemo: 'expected-memo',
        expectedMemo: 'expected-memo',
      });
      assert.equal(res.ok, true);
      assert.equal(res.stage, 'match_memo');
    });
  });

  describe('Stage 6: attributeStage', () => {
    it('fails when payer email is invalid', () => {
      const res = attributeStage({
        payer: { payerEmail: 'not-an-email' },
        invoiceStatus: 'PENDING',
      });
      assert.equal(res.ok, false);
      assert.equal(res.stage, 'attribute');
      assert.equal(res.code, 'INVALID_PAYER_EMAIL');
    });

    it('fails when invoice is CANCELLED and close time is unavailable', () => {
      const res = attributeStage({
        payer: { payerName: 'Bob' },
        invoiceStatus: 'CANCELLED',
        settledAt: undefined,
      });
      assert.equal(res.ok, false);
      assert.equal(res.stage, 'attribute');
      assert.equal(res.code, 'TRANSACTION_CLOSE_TIME_UNAVAILABLE');
    });

    it('succeeds when payer info is valid', () => {
      const res = attributeStage({
        payer: { payerName: 'Alice', payerEmail: 'alice@example.com' },
        invoiceStatus: 'PENDING',
      });
      assert.equal(res.ok, true);
      assert.equal(res.stage, 'attribute');
    });
  });

  describe('Stage 7: persistPaidStage', () => {
    it('fails when transaction hash was already claimed', async () => {
      const storage = createMockStorage({ failMode: 'already_used' });
      const res = await persistPaidStage({
        invoiceId: 'inv_1',
        invoiceStatus: 'PENDING',
        storage,
        txHash: ALREADY_USED_TX_HASH,
        from: BUYER_PUBLIC_KEY,
      });
      assert.equal(res.ok, false);
      assert.equal(res.stage, 'persist_paid');
      assert.equal(res.code, 'TX_HASH_ALREADY_USED');
    });

    it('succeeds and marks invoice as paid in storage', async () => {
      const storage = createMockStorage();
      const res = await persistPaidStage({
        invoiceId: 'inv_1',
        invoiceStatus: 'PENDING',
        storage,
        txHash: VALID_TX_HASH,
        from: BUYER_PUBLIC_KEY,
        payer: { payerName: 'Alice' },
      });
      assert.equal(res.ok, true);
      assert.equal(res.stage, 'persist_paid');
      if (res.ok) {
        assert.equal(res.value.invoice.status, 'PAID');
        assert.equal(res.value.invoice.paymentTxHash, VALID_TX_HASH);
      }
    });
  });
});

describe('Full Pipeline Execution and Short-Circuiting', () => {
  it('short-circuits at stage 1 (fetch_transaction) on hash check failure', async () => {
    const testCase = PIPELINE_STAGE_CASES.fetchTransactionFailHash;
    const storage = createMockStorage();
    const result = await executePaymentVerificationPipeline({
      invoice: testCase.invoice,
      txHash: testCase.txHash,
      storage,
      transaction: testCase.transaction,
      operations: testCase.operations,
    });
    assert.equal(result.ok, false);
    assert.equal(result.stage, 'fetch_transaction');
    assert.equal(result.code, testCase.expectedCode);
    assert.deepEqual(result.stagesCompleted, testCase.expectedStagesCompleted);
  });

  it('short-circuits at stage 1 (fetch_transaction) on missing payment operations', async () => {
    const testCase = PIPELINE_STAGE_CASES.fetchTransactionFailNotFound;
    const storage = createMockStorage();
    const result = await executePaymentVerificationPipeline({
      invoice: testCase.invoice,
      txHash: testCase.txHash,
      storage,
      transaction: testCase.transaction,
      operations: testCase.operations,
    });
    assert.equal(result.ok, false);
    assert.equal(result.stage, 'fetch_transaction');
    assert.equal(result.code, testCase.expectedCode);
    assert.deepEqual(result.stagesCompleted, testCase.expectedStagesCompleted);
  });

  it('short-circuits at stage 2 (match_destination)', async () => {
    const testCase = PIPELINE_STAGE_CASES.matchDestinationFail;
    const storage = createMockStorage();
    const result = await executePaymentVerificationPipeline({
      invoice: testCase.invoice,
      txHash: testCase.txHash,
      storage,
      transaction: testCase.transaction,
      operations: testCase.operations,
    });
    assert.equal(result.ok, false);
    assert.equal(result.stage, 'match_destination');
    assert.equal(result.code, testCase.expectedCode);
    assert.deepEqual(result.stagesCompleted, testCase.expectedStagesCompleted);
  });

  it('short-circuits at stage 3 (match_asset)', async () => {
    const testCase = PIPELINE_STAGE_CASES.matchAssetFail;
    const storage = createMockStorage();
    const result = await executePaymentVerificationPipeline({
      invoice: testCase.invoice,
      txHash: testCase.txHash,
      storage,
      transaction: testCase.transaction,
      operations: testCase.operations,
    });
    assert.equal(result.ok, false);
    assert.equal(result.stage, 'match_asset');
    assert.equal(result.code, testCase.expectedCode);
    assert.deepEqual(result.stagesCompleted, testCase.expectedStagesCompleted);
  });

  it('short-circuits at stage 4 (match_amount)', async () => {
    const testCase = PIPELINE_STAGE_CASES.matchAmountFail;
    const storage = createMockStorage();
    const result = await executePaymentVerificationPipeline({
      invoice: testCase.invoice,
      txHash: testCase.txHash,
      storage,
      transaction: testCase.transaction,
      operations: testCase.operations,
    });
    assert.equal(result.ok, false);
    assert.equal(result.stage, 'match_amount');
    assert.equal(result.code, testCase.expectedCode);
    assert.deepEqual(result.stagesCompleted, testCase.expectedStagesCompleted);
  });

  it('short-circuits at stage 5 (match_memo)', async () => {
    const testCase = PIPELINE_STAGE_CASES.matchMemoFail;
    const storage = createMockStorage();
    const result = await executePaymentVerificationPipeline({
      invoice: testCase.invoice,
      txHash: testCase.txHash,
      storage,
      transaction: testCase.transaction,
      operations: testCase.operations,
    });
    assert.equal(result.ok, false);
    assert.equal(result.stage, 'match_memo');
    assert.equal(result.code, testCase.expectedCode);
    assert.deepEqual(result.stagesCompleted, testCase.expectedStagesCompleted);
  });

  it('short-circuits at stage 6 (attribute)', async () => {
    const testCase = PIPELINE_STAGE_CASES.attributeFail;
    const storage = createMockStorage();
    const result = await executePaymentVerificationPipeline({
      invoice: testCase.invoice,
      txHash: testCase.txHash,
      storage,
      transaction: testCase.transaction,
      operations: testCase.operations,
      payer: testCase.payer,
    });
    assert.equal(result.ok, false);
    assert.equal(result.stage, 'attribute');
    assert.equal(result.code, testCase.expectedCode);
    assert.deepEqual(result.stagesCompleted, testCase.expectedStagesCompleted);
  });

  it('short-circuits at stage 7 (persist_paid)', async () => {
    const testCase = PIPELINE_STAGE_CASES.persistPaidFail;
    const storage = createMockStorage({ failMode: testCase.mockStorageFail });
    const result = await executePaymentVerificationPipeline({
      invoice: testCase.invoice,
      txHash: testCase.txHash,
      storage,
      transaction: testCase.transaction,
      operations: testCase.operations,
    });
    assert.equal(result.ok, false);
    assert.equal(result.stage, 'persist_paid');
    assert.equal(result.code, testCase.expectedCode);
    assert.deepEqual(result.stagesCompleted, testCase.expectedStagesCompleted);
  });

  it('completes all 7 stages successfully and transitions invoice to PAID', async () => {
    const testCase = PIPELINE_STAGE_CASES.fullSuccess;
    const storage = createMockStorage();
    let beforePersistRan = false;
    let afterPersistRan = false;

    const result = await executePaymentVerificationPipeline({
      invoice: testCase.invoice,
      txHash: testCase.txHash,
      storage,
      transaction: testCase.transaction,
      operations: testCase.operations,
      payer: testCase.payer,
      onBeforePersist: async () => {
        beforePersistRan = true;
      },
      onAfterPersist: async () => {
        afterPersistRan = true;
      },
    });

    assert.equal(result.ok, true);
    assert.equal(result.stage, 'persist_paid');
    assert.equal(beforePersistRan, true);
    assert.equal(afterPersistRan, true);
    assert.deepEqual(result.stagesCompleted, testCase.expectedStagesCompleted);

    if (result.ok) {
      assert.equal(result.invoice.status, 'PAID');
      assert.equal(result.invoice.paymentTxHash, VALID_TX_HASH);
      assert.equal(result.invoice.payerName, 'Alice');
      assert.equal(result.invoice.payerEmail, 'alice@example.com');
    }
  });
});
