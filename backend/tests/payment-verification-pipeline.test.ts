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
import type { StoredInvoice } from '../src/storage/invoice-storage.ts';
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

function createMockStorage(
  options: {
    failMode?: 'already_used' | 'already_paid';
    existingInvoice?: StoredInvoice;
  } = {}
): PersistPaidStorage {
  const invoice = options.existingInvoice ?? createTestInvoice();
  return {
    async markAsPaid(id, txHash, payerPublicKey, payer, opts) {
      if (options.failMode === 'already_used' || txHash === ALREADY_USED_TX_HASH) {
        throw new PaymentClaimError(String(txHash), id, 'inv_other');
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
        settledAt: opts?.settledAt ?? new Date(),
      };
    },
    async getInvoiceById(id) {
      return { ...invoice, id };
    },
  };
}

describe('Payment Verification Pipeline Stages', () => {
  it('defines the 7 required stages in exact execution order', () => {
    assert.deepEqual([...VERIFICATION_STAGES], [
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
      const res = await fetchTransactionStage({ txHash: 'invalid-hash' });
      assert.equal(res.ok, false);
      if (res.ok) return;
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
      if (res.ok) return;
      assert.equal(res.stage, 'fetch_transaction');
      assert.equal(res.code, 'NETWORK_MISMATCH');
    });

    it('fails when no payment operation exists', async () => {
      const res = await fetchTransactionStage({
        txHash: VALID_TX_HASH,
        transaction: createTestTransaction(),
        operations: [
          { type: 'create_account', account: BUYER_PUBLIC_KEY, starting_balance: '10' } as any,
        ],
        expectedDestination: SELLER_PUBLIC_KEY,
      });
      assert.equal(res.ok, false);
      if (res.ok) return;
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
        operation: op,
        expectedDestination: SELLER_PUBLIC_KEY,
      });
      assert.equal(res.ok, false);
      if (res.ok) return;
      assert.equal(res.stage, 'match_destination');
      assert.equal(res.code, 'DESTINATION_MISMATCH');
    });

    it('succeeds when destination matches seller', () => {
      const op = createTestOperation({ to: SELLER_PUBLIC_KEY });
      const res = matchDestinationStage({
        operation: op,
        expectedDestination: SELLER_PUBLIC_KEY,
      });
      assert.equal(res.ok, true);
      if (res.ok) {
        assert.equal(res.value.destination, SELLER_PUBLIC_KEY);
      }
    });
  });

  describe('Stage 3: matchAssetStage', () => {
    it('fails on asset mismatch', () => {
      const res = matchAssetStage({
        operation: createTestOperation({ asset_code: 'EURC' }),
        expectedAssetCode: 'USDC',
        expectedAssetIssuer: SELLER_PUBLIC_KEY,
      });
      assert.equal(res.ok, false);
      if (res.ok) return;
      assert.equal(res.code, 'ASSET_MISMATCH');
    });

    it('succeeds on matching asset', () => {
      const res = matchAssetStage({
        operation: createTestOperation(),
        expectedAssetCode: 'USDC',
        expectedAssetIssuer: SELLER_PUBLIC_KEY,
      });
      assert.equal(res.ok, true);
    });
  });

  describe('Stage 4: matchAmountStage', () => {
    it('fails when amount is too low', () => {
      const res = matchAmountStage({
        operation: createTestOperation({ amount: '10.0000000' }),
        expectedAmount: 25.5,
      });
      assert.equal(res.ok, false);
      if (res.ok) return;
      assert.equal(res.code, 'AMOUNT_TOO_LOW');
    });

    it('succeeds when amount matches', () => {
      const res = matchAmountStage({
        operation: createTestOperation({ amount: '25.5000000' }),
        expectedAmount: 25.5,
      });
      assert.equal(res.ok, true);
    });
  });

  describe('Stage 5: matchMemoStage', () => {
    it('fails when memo mismatches', () => {
      const res = matchMemoStage({
        transactionMemo: 'wrong',
        transactionMemoType: 'text',
        expectedMemo: 'order-101',
      });
      assert.equal(res.ok, false);
      if (res.ok) return;
      assert.equal(res.code, 'MEMO_MISMATCH');
    });

    it('fails when memo type is not text', () => {
      const res = matchMemoStage({
        transactionMemo: 'order-101',
        transactionMemoType: 'hash',
        expectedMemo: 'order-101',
      });
      assert.equal(res.ok, false);
      if (res.ok) return;
      assert.equal(res.code, 'MEMO_TYPE_MISMATCH');
    });

    it('succeeds when memo matches', () => {
      const res = matchMemoStage({
        transactionMemo: 'order-101',
        transactionMemoType: 'text',
        expectedMemo: 'order-101',
      });
      assert.equal(res.ok, true);
    });
  });

  describe('Stage 6: attributeStage', () => {
    it('fails on invalid payer email', () => {
      const res = attributeStage({
        payer: { payerEmail: 'nope' },
        invoiceStatus: 'PENDING',
        settledAt: new Date(),
        requireSettledAt: true,
      });
      assert.equal(res.ok, false);
      if (res.ok) return;
      assert.equal(res.code, 'INVALID_PAYER_EMAIL');
    });

    it('fails when close time is required but missing', () => {
      const res = attributeStage({
        invoiceStatus: 'PENDING',
        requireSettledAt: true,
      });
      assert.equal(res.ok, false);
      if (res.ok) return;
      assert.equal(res.code, 'TRANSACTION_CLOSE_TIME_UNAVAILABLE');
    });

    it('succeeds with valid payer and settledAt', () => {
      const settledAt = new Date('2026-09-01T12:05:00.000Z');
      const res = attributeStage({
        payer: { payerName: 'Alice', payerEmail: 'alice@example.com' },
        invoiceStatus: 'PENDING',
        settledAt,
        requireSettledAt: true,
      });
      assert.equal(res.ok, true);
      if (res.ok) {
        assert.equal(res.value.payerEmail, 'alice@example.com');
        assert.equal(res.value.settledAt, settledAt);
      }
    });
  });

  describe('Stage 7: persistPaidStage', () => {
    it('maps PaymentClaimError to TX_HASH_ALREADY_USED', async () => {
      const res = await persistPaidStage({
        invoiceId: 'inv_pipeline_test_123',
        invoiceStatus: 'PENDING',
        storage: createMockStorage({ failMode: 'already_used' }),
        txHash: VALID_TX_HASH,
        from: BUYER_PUBLIC_KEY,
        settledAt: new Date(),
      });
      assert.equal(res.ok, false);
      if (res.ok) return;
      assert.equal(res.code, 'TX_HASH_ALREADY_USED');
    });

    it('persists PAID on success', async () => {
      const res = await persistPaidStage({
        invoiceId: 'inv_pipeline_test_123',
        invoiceStatus: 'PENDING',
        storage: createMockStorage(),
        txHash: VALID_TX_HASH,
        from: BUYER_PUBLIC_KEY,
        payer: { payerName: 'Alice' },
        settledAt: new Date(),
      });
      assert.equal(res.ok, true);
      if (res.ok) {
        assert.equal(res.value.invoice.status, 'PAID');
        assert.equal(res.value.invoice.paymentTxHash, VALID_TX_HASH);
      }
    });
  });

  describe('executePaymentVerificationPipeline short-circuit', () => {
    for (const [key, testCase] of Object.entries(PIPELINE_STAGE_CASES)) {
      it(testCase.name, async () => {
        const result = await executePaymentVerificationPipeline({
          invoice: testCase.invoice,
          txHash: testCase.txHash,
          transaction: testCase.transaction,
          operations: testCase.operations,
          payer: testCase.payer,
          storage: createMockStorage({
            failMode: testCase.mockStorageFail,
            existingInvoice: testCase.invoice,
          }),
          requireSettledAt: true,
        });

        assert.deepEqual(result.stagesCompleted, testCase.expectedStagesCompleted);

        if (testCase.stageToFail) {
          assert.equal(result.ok, false);
          if (result.ok) return;
          assert.equal(result.stage, testCase.stageToFail);
          assert.equal(result.code, testCase.expectedCode);
        } else {
          assert.equal(result.ok, true);
          if (!result.ok) return;
          assert.equal(result.invoice.status, 'PAID');
          assert.equal(result.txHash, VALID_TX_HASH);
        }
      });
    }
  });
});
