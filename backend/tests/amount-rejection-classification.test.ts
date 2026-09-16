import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  VERIFICATION_CODES,
  amountRejectionCode,
  messageForCode,
  verifyHorizonPayment,
} from '../src/services/payment-verification.ts';
import type {
  ExpectedPayment,
  HorizonOperationLike,
  VerifyPaymentInput,
} from '../src/services/payment-verification.ts';

const SELLER = 'GSELLERAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const PAYER = 'GPAYERAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const OTHER_ACCOUNT = 'GATTACKERAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const USDC_ISSUER = 'GISSUERAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const TX_HASH = 'a1b2c3d4'.repeat(8);
const MEMO = 'INV-AMT01';

function input(
  operation: Partial<HorizonOperationLike>,
  expectedOverrides: Partial<ExpectedPayment> = {}
): VerifyPaymentInput {
  return {
    txHash: TX_HASH,
    expected: {
      memo: MEMO,
      amount: '100.0000000',
      destination: SELLER,
      assetCode: 'XLM',
      ...expectedOverrides,
    },
    transaction: { memo: MEMO, memo_type: 'text' },
    operations: [
      {
        type: 'payment',
        from: PAYER,
        to: SELLER,
        amount: '100.0000000',
        asset_type: 'native',
        ...operation,
      },
    ],
  };
}

function usdcInput(amount: string, expectedAmount: string): VerifyPaymentInput {
  return input(
    {
      amount,
      asset_type: 'credit_alphanum4',
      asset_code: 'USDC',
      asset_issuer: USDC_ISSUER,
    },
    { amount: expectedAmount, assetCode: 'USDC', assetIssuer: USDC_ISSUER }
  );
}

function codeOf(result: ReturnType<typeof verifyHorizonPayment>): string {
  assert.equal(result.ok, false, 'expected verification to fail');
  return result.ok ? '' : result.code;
}

describe('amount check - XLM', () => {
  it('settles on the exact amount', () => {
    const result = verifyHorizonPayment(input({}));
    assert.equal(result.ok, true);
  });

  it('reports one stroop short as a shortfall and keeps the invoice unsettled', () => {
    const result = verifyHorizonPayment(input({ amount: '99.9999999' }));

    assert.equal(codeOf(result), 'AMOUNT_TOO_LOW');
    assert.equal(
      result.ok ? '' : result.error,
      'Payment is less than the invoice amount'
    );
  });

  it('reports 50% underpayment as a shortfall and keeps the invoice unsettled', () => {
    const result = verifyHorizonPayment(input({ amount: '50.0000000' }));

    assert.equal(codeOf(result), 'AMOUNT_TOO_LOW');
    assert.equal(
      result.ok ? '' : result.error,
      'Payment is less than the invoice amount'
    );
  });

  it('reports dust underpayment as a shortfall and keeps the invoice unsettled', () => {
    const result = verifyHorizonPayment(input({ amount: '0.0000001' }));

    assert.equal(codeOf(result), 'AMOUNT_TOO_LOW');
    assert.equal(
      result.ok ? '' : result.error,
      'Payment is less than the invoice amount'
    );
  });

  it('reports one stroop over as an excess', () => {
    const result = verifyHorizonPayment(input({ amount: '100.0000001' }));

    assert.equal(codeOf(result), 'AMOUNT_TOO_HIGH');
    assert.equal(
      result.ok ? '' : result.error,
      'Payment is more than the invoice amount'
    );
  });

  it('reports large overpayment as an excess', () => {
    const result = verifyHorizonPayment(input({ amount: '150.0000000' }));

    assert.equal(codeOf(result), 'AMOUNT_TOO_HIGH');
    assert.equal(
      result.ok ? '' : result.error,
      'Payment is more than the invoice amount'
    );
  });

  it('accepts dust below half a stroop and rejects the dust that rounds up', () => {
    assert.equal(verifyHorizonPayment(input({ amount: '100.00000004' })).ok, true);
    assert.equal(
      codeOf(verifyHorizonPayment(input({ amount: '100.00000005' }))),
      'AMOUNT_TOO_HIGH'
    );
  });

  it('keeps the generic code when the observed amount cannot be parsed', () => {
    assert.equal(codeOf(verifyHorizonPayment(input({ amount: 'abc' }))), 'AMOUNT_MISMATCH');
    assert.equal(codeOf(verifyHorizonPayment(input({ amount: '' }))), 'AMOUNT_MISMATCH');
  });
});

describe('amount check - USDC', () => {
  it('settles on the exact amount', () => {
    assert.equal(verifyHorizonPayment(usdcInput('25.0000000', '25.0000000')).ok, true);
  });

  it('separates a shortfall from an excess', () => {
    assert.equal(
      codeOf(verifyHorizonPayment(usdcInput('24.9999999', '25.0000000'))),
      'AMOUNT_TOO_LOW'
    );
    assert.equal(
      codeOf(verifyHorizonPayment(usdcInput('25.0000001', '25.0000000'))),
      'AMOUNT_TOO_HIGH'
    );
  });

  it('reports 50% underpayment for USDC as a shortfall', () => {
    assert.equal(
      codeOf(verifyHorizonPayment(usdcInput('12.5000000', '25.0000000'))),
      'AMOUNT_TOO_LOW'
    );
  });

  it('reports dust underpayment for USDC as a shortfall', () => {
    assert.equal(
      codeOf(verifyHorizonPayment(usdcInput('0.0000001', '25.0000000'))),
      'AMOUNT_TOO_LOW'
    );
  });

  it('reports large overpayment for USDC as an excess', () => {
    assert.equal(
      codeOf(verifyHorizonPayment(usdcInput('50.0000000', '25.0000000'))),
      'AMOUNT_TOO_HIGH'
    );
  });
});

describe('amount check - contract', () => {
  it('runs the amount check after memo and destination', () => {
    const wrongMemo = input({ amount: '1' });
    wrongMemo.transaction.memo = 'WRONG';
    assert.equal(codeOf(verifyHorizonPayment(wrongMemo)), 'MEMO_MISMATCH');

    assert.equal(
      codeOf(verifyHorizonPayment(input({ amount: '1', to: OTHER_ACCOUNT }))),
      'DESTINATION_MISMATCH'
    );
  });

  it('classifies the delta directly, including values it cannot compare', () => {
    assert.equal(amountRejectionCode('99.9999999', '100.0000000'), 'AMOUNT_TOO_LOW');
    assert.equal(amountRejectionCode('100.0000001', '100'), 'AMOUNT_TOO_HIGH');
    assert.equal(amountRejectionCode('100.0000000', '100'), 'AMOUNT_MISMATCH');
    assert.equal(amountRejectionCode(null, '100'), 'AMOUNT_MISMATCH');
    assert.equal(amountRejectionCode('abc', 100), 'AMOUNT_MISMATCH');
  });

  it('publishes a message for both new codes on both sides of the contract', () => {
    assert.ok(VERIFICATION_CODES.includes('AMOUNT_TOO_LOW'));
    assert.ok(VERIFICATION_CODES.includes('AMOUNT_TOO_HIGH'));
    assert.equal(messageForCode('AMOUNT_TOO_LOW'), 'Payment is less than the invoice amount');
    assert.equal(messageForCode('AMOUNT_TOO_HIGH'), 'Payment is more than the invoice amount');
  });
});
