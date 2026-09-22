import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  verifyHorizonPayment,
  selectMatchingPaymentOperation,
  findPaymentOperation,
  resolveTransactionMemo,
} from '../src/services/payment-verification';
import {
  MULTI_OP_FIXTURES,
  TEST_TX_HASH,
  TEST_SELLER,
  TEST_PAYER,
  TEST_OTHER,
  TEST_USDC_ISSUER,
} from './fixtures/multi-operation-payment.fixture';

describe('Multi-operation payment verification fixture suite', () => {
  for (const fixture of MULTI_OP_FIXTURES) {
    it(fixture.name, () => {
      const result = verifyHorizonPayment({
        txHash: TEST_TX_HASH,
        expected: fixture.expectedPayment,
        transaction: fixture.transaction,
        operations: fixture.operations,
      });

      assert.equal(
        result.ok,
        fixture.expectedResult,
        `Expected ok to be ${fixture.expectedResult} for ${fixture.name}`
      );

      if (!result.ok && fixture.expectedCode) {
        assert.equal(
          result.code,
          fixture.expectedCode,
          `Expected error code ${fixture.expectedCode} for ${fixture.name}`
        );
      }

      if (result.ok) {
        assert.equal(result.value.to, fixture.expectedPayment.destination);
        assert.equal(result.value.amount, fixture.expectedPayment.amount);
        assert.equal(result.value.assetCode, fixture.expectedPayment.assetCode);
      }
    });
  }
});

describe('selectMatchingPaymentOperation unit behavior', () => {
  it('selects the unique matching operation from mixed operations', () => {
    const operations = [
      {
        type: 'change_trust',
        from: TEST_PAYER,
        asset_type: 'credit_alphanum4',
        asset_code: 'USDC',
        asset_issuer: TEST_USDC_ISSUER,
      },
      {
        type: 'payment',
        from: TEST_PAYER,
        to: TEST_OTHER,
        amount: '10.0000000',
        asset_type: 'native',
      },
      {
        type: 'payment',
        from: TEST_PAYER,
        to: TEST_SELLER,
        amount: '50.0000000',
        asset_type: 'native',
      },
    ];

    const expected = {
      destination: TEST_SELLER,
      amount: '50.0000000',
      assetCode: 'XLM',
      memo: 'MEMO-1',
    };

    const { match, matchCount } = selectMatchingPaymentOperation(operations, expected);
    assert.equal(matchCount, 1);
    assert.ok(match);
    assert.equal(match?.to, TEST_SELLER);
    assert.equal(match?.amount, '50.0000000');
  });

  it('reports matchCount of 2 when multiple operations match identically', () => {
    const operations = [
      {
        type: 'payment',
        from: TEST_PAYER,
        to: TEST_SELLER,
        amount: '20.0000000',
        asset_type: 'native',
      },
      {
        type: 'payment',
        from: TEST_PAYER,
        to: TEST_SELLER,
        amount: '20.0000000',
        asset_type: 'native',
      },
    ];

    const expected = {
      destination: TEST_SELLER,
      amount: '20.0000000',
      assetCode: 'XLM',
      memo: 'MEMO-2',
    };

    const { match, matchCount } = selectMatchingPaymentOperation(operations, expected);
    assert.equal(matchCount, 2);
    assert.equal(match, null);
  });

  it('reports matchCount of 0 when no operations match destination and amount', () => {
    const operations = [
      {
        type: 'payment',
        from: TEST_PAYER,
        to: TEST_OTHER,
        amount: '20.0000000',
        asset_type: 'native',
      },
    ];

    const expected = {
      destination: TEST_SELLER,
      amount: '20.0000000',
      assetCode: 'XLM',
      memo: 'MEMO-3',
    };

    const { match, matchCount } = selectMatchingPaymentOperation(operations, expected);
    assert.equal(matchCount, 0);
    assert.equal(match, null);
  });
});

describe('findPaymentOperation backward-compatibility and expected parameter', () => {
  it('returns unique match when expected parameter is provided', () => {
    const operations = [
      {
        type: 'payment',
        from: TEST_PAYER,
        to: TEST_OTHER,
        amount: '10.0000000',
        asset_type: 'native',
      },
      {
        type: 'payment',
        from: TEST_PAYER,
        to: TEST_SELLER,
        amount: '40.0000000',
        asset_type: 'native',
      },
    ];

    const match = findPaymentOperation(operations, {
      destination: TEST_SELLER,
      amount: '40.0000000',
      assetCode: 'XLM',
      memo: 'MEMO-4',
    });

    assert.ok(match);
    assert.equal(match?.to, TEST_SELLER);
    assert.equal(match?.amount, '40.0000000');
  });

  it('returns first payment to destination when destination string is provided', () => {
    const operations = [
      {
        type: 'payment',
        from: TEST_PAYER,
        to: TEST_OTHER,
        amount: '10.0000000',
        asset_type: 'native',
      },
      {
        type: 'payment',
        from: TEST_PAYER,
        to: TEST_SELLER,
        amount: '40.0000000',
        asset_type: 'native',
      },
    ];

    const match = findPaymentOperation(operations, TEST_SELLER);
    assert.ok(match);
    assert.equal(match?.to, TEST_SELLER);
  });

  it('returns first candidate payment operation when no destination is provided', () => {
    const operations = [
      {
        type: 'change_trust',
      },
      {
        type: 'payment',
        from: TEST_PAYER,
        to: TEST_OTHER,
        amount: '10.0000000',
        asset_type: 'native',
      },
    ];

    const match = findPaymentOperation(operations);
    assert.ok(match);
    assert.equal(match?.to, TEST_OTHER);
  });

  it('returns null when no payment operations exist', () => {
    const operations = [
      {
        type: 'change_trust',
      },
      {
        type: 'manage_data',
      },
    ];

    const match = findPaymentOperation(operations);
    assert.equal(match, null);
  });
});

describe('resolveTransactionMemo', () => {
  it('prefers top-level memo when present', () => {
    const memo = resolveTransactionMemo({
      memo: 'TOP-MEMO',
      inner_transaction: {
        memo: 'INNER-MEMO',
      },
    });
    assert.equal(memo, 'TOP-MEMO');
  });

  it('falls back to inner_transaction memo when top-level memo is absent', () => {
    const memo = resolveTransactionMemo({
      memo: null,
      inner_transaction: {
        memo: 'INNER-MEMO-ONLY',
      },
    });
    assert.equal(memo, 'INNER-MEMO-ONLY');
  });

  it('returns empty string when neither top-level nor inner memo is present', () => {
    const memo = resolveTransactionMemo({});
    assert.equal(memo, '');
  });
});
