import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  VERIFICATION_MESSAGES,
  VERIFICATION_CODES,
  messageForCode,
  STROOP_PRECISION,
  amountsMatch,
  checkInvoiceIsPayable,
  checkPayerInfo,
  checkTxHash,
  isValidTxHash,
  verifyHorizonPayment,
} from '../src/services/payment-verification.ts';
import type {
  ExpectedPayment,
  HorizonOperationLike,
  VerifyPaymentInput,
} from '../src/services/payment-verification.ts';

const SELLER = 'GSELLERAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const OTHER_ACCOUNT = 'GATTACKERAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const PAYER = 'GPAYERAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const USDC_ISSUER = 'GISSUERAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const TX_HASH = 'a1b2c3d4'.repeat(8); // 64 hex characters

function expected(overrides: Partial<ExpectedPayment> = {}): ExpectedPayment {
  return {
    memo: 'INV-2K4H9',
    amount: 100,
    destination: SELLER,
    assetCode: 'XLM',
    ...overrides,
  };
}

function paymentOp(overrides: Partial<HorizonOperationLike> = {}): HorizonOperationLike {
  return {
    type: 'payment',
    from: PAYER,
    to: SELLER,
    amount: '100.0000000',
    asset_type: 'native',
    ...overrides,
  };
}

function input(overrides: Partial<VerifyPaymentInput> = {}): VerifyPaymentInput {
  return {
    txHash: TX_HASH,
    expected: expected(),
    transaction: { memo: 'INV-2K4H9', memo_type: 'text' },
    operations: [paymentOp()],
    ...overrides,
  };
}

/** Narrow a result to its failure code, failing loudly if it unexpectedly passed. */
function codeOf(result: ReturnType<typeof verifyHorizonPayment>): string {
  assert.equal(result.ok, false, 'expected verification to fail');
  return result.ok ? '' : result.code;
}

describe('verifyHorizonPayment — happy path', () => {
  it('compares values at Stellar stroop precision', () => {
    assert.equal(STROOP_PRECISION, 7);
    assert.equal(amountsMatch('1.00000004', 1), true);
    assert.equal(amountsMatch('1.00000006', 1), false);
    assert.equal(amountsMatch('not-an-amount', 1), false);
  });

  it('accepts a payment matching memo, destination, amount, and asset', () => {
    const result = verifyHorizonPayment(input());

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(result.value, {
      txHash: TX_HASH,
      from: PAYER,
      to: SELLER,
      amount: '100.0000000',
      assetCode: 'XLM',
      assetIssuer: undefined,
      memo: 'INV-2K4H9',
    });
  });

  it('treats equivalent amount formats as equal to stroop precision', () => {
    const result = verifyHorizonPayment(
      input({
        expected: expected({ amount: '100' }),
        operations: [paymentOp({ amount: '100.0000000' })],
      })
    );

    assert.equal(result.ok, true);
  });

  it('accepts a non-native asset when code and issuer both match', () => {
    const result = verifyHorizonPayment(
      input({
        expected: expected({ assetCode: 'USDC', assetIssuer: USDC_ISSUER }),
        operations: [
          paymentOp({
            asset_type: 'credit_alphanum4',
            asset_code: 'USDC',
            asset_issuer: USDC_ISSUER,
          }),
        ],
      })
    );

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.value.assetCode, 'USDC');
    assert.equal(result.value.assetIssuer, USDC_ISSUER);
  });

  it('ignores non-payment operations alongside the payment', () => {
    const result = verifyHorizonPayment(
      input({ operations: [{ type: 'manage_data' }, paymentOp()] })
    );

    assert.equal(result.ok, true);
  });
});

describe('verifyHorizonPayment — rejections', () => {
  it('rejects a malformed transaction hash before anything else', () => {
    assert.equal(codeOf(verifyHorizonPayment(input({ txHash: 'not-a-hash' }))), 'INVALID_TX_HASH');
    assert.equal(codeOf(verifyHorizonPayment(input({ txHash: 'abc123' }))), 'INVALID_TX_HASH');
    // 64 characters, but 'z' is not hexadecimal.
    assert.equal(codeOf(verifyHorizonPayment(input({ txHash: 'z'.repeat(64) }))), 'INVALID_TX_HASH');
    assert.equal(codeOf(verifyHorizonPayment(input({ txHash: '' }))), 'MISSING_TX_HASH');
  });

  it('rejects a memo mismatch', () => {
    const result = verifyHorizonPayment(
      input({ transaction: { memo: 'INV-WRONG', memo_type: 'text' } })
    );

    assert.equal(codeOf(result), 'MEMO_MISMATCH');
    assert.equal(result.ok ? '' : result.error, 'Memo mismatch');
  });

  it('rejects a missing memo', () => {
    assert.equal(codeOf(verifyHorizonPayment(input({ transaction: {} }))), 'MEMO_MISMATCH');
  });

  it('rejects a payment sent to the wrong destination', () => {
    const result = verifyHorizonPayment(
      input({ operations: [paymentOp({ to: OTHER_ACCOUNT })] })
    );

    assert.equal(codeOf(result), 'DESTINATION_MISMATCH');
  });

  it('rejects a partial payment', () => {
    const result = verifyHorizonPayment(
      input({ operations: [paymentOp({ amount: '99.9999999' })] })
    );

    assert.equal(codeOf(result), 'AMOUNT_MISMATCH');
  });

  it('rejects an overpayment and an unparseable amount', () => {
    assert.equal(
      codeOf(verifyHorizonPayment(input({ operations: [paymentOp({ amount: '150' })] }))),
      'AMOUNT_MISMATCH'
    );
    assert.equal(
      codeOf(verifyHorizonPayment(input({ operations: [paymentOp({ amount: 'abc' })] }))),
      'AMOUNT_MISMATCH'
    );
  });

  it('rejects payment in the wrong asset', () => {
    const result = verifyHorizonPayment(
      input({
        operations: [
          paymentOp({
            asset_type: 'credit_alphanum4',
            asset_code: 'USDC',
            asset_issuer: USDC_ISSUER,
          }),
        ],
      })
    );

    assert.equal(codeOf(result), 'ASSET_MISMATCH');
  });

  it('rejects a same-code asset from the wrong issuer', () => {
    const result = verifyHorizonPayment(
      input({
        expected: expected({ assetCode: 'USDC', assetIssuer: USDC_ISSUER }),
        operations: [
          paymentOp({
            asset_type: 'credit_alphanum4',
            asset_code: 'USDC',
            asset_issuer: OTHER_ACCOUNT,
          }),
        ],
      })
    );

    assert.equal(codeOf(result), 'ASSET_MISMATCH');
  });

  it('refuses a credit asset coded XLM against a native invoice', () => {
    // Anyone can issue an asset whose code is "XLM". Comparing codes alone
    // would let a worthless look-alike settle a native invoice.
    const result = verifyHorizonPayment(
      input({
        expected: expected({ assetCode: 'XLM' }),
        operations: [
          paymentOp({
            asset_type: 'credit_alphanum4',
            asset_code: 'XLM',
            asset_issuer: OTHER_ACCOUNT,
          }),
        ],
      }),
    );

    assert.equal(codeOf(result), 'ASSET_MISMATCH');
  });

  it('refuses a native payment against a credit invoice', () => {
    const result = verifyHorizonPayment(
      input({
        expected: expected({ assetCode: 'USDC', assetIssuer: USDC_ISSUER }),
        operations: [paymentOp({ asset_type: 'native' })],
      }),
    );

    assert.equal(codeOf(result), 'ASSET_MISMATCH');
  });

  it('refuses a credit invoice that records no issuer', () => {
    // An asset nobody pinned is not an asset anyone agreed to accept, so it is
    // unsettleable rather than settleable by anything.
    const result = verifyHorizonPayment(
      input({
        expected: expected({ assetCode: 'USDC' }),
        operations: [
          paymentOp({
            asset_type: 'credit_alphanum4',
            asset_code: 'USDC',
            asset_issuer: USDC_ISSUER,
          }),
        ],
      }),
    );

    assert.equal(codeOf(result), 'ASSET_MISMATCH');
  });

  it('rejects a transaction with no payment operation', () => {
    assert.equal(
      codeOf(verifyHorizonPayment(input({ operations: [{ type: 'create_account' }] }))),
      'NO_PAYMENT_OPERATION'
    );
    assert.equal(codeOf(verifyHorizonPayment(input({ operations: [] }))), 'NO_PAYMENT_OPERATION');
  });

  it('rejects a transaction observed on a different network', () => {
    const result = verifyHorizonPayment(
      input({ expected: expected({ network: 'PUBLIC' }), network: 'TESTNET' })
    );

    assert.equal(codeOf(result), 'NETWORK_MISMATCH');
  });

  it('skips the network guard when either side is unknown', () => {
    assert.equal(verifyHorizonPayment(input({ network: 'TESTNET' })).ok, true);
    assert.equal(verifyHorizonPayment(input({ expected: expected({ network: 'TESTNET' }) })).ok, true);
  });
});

describe('verifyHorizonPayment — check ordering', () => {
  it('reports the first failure in a fixed order so every caller agrees', () => {
    // A payment wrong in several ways at once: memo is reported first, then
    // destination, then amount, then asset.
    const allWrong = input({
      transaction: { memo: 'INV-WRONG' },
      operations: [
        paymentOp({
          to: OTHER_ACCOUNT,
          amount: '1',
          asset_type: 'credit_alphanum4',
          asset_code: 'USDC',
          asset_issuer: USDC_ISSUER,
        }),
      ],
    });
    assert.equal(codeOf(verifyHorizonPayment(allWrong)), 'MEMO_MISMATCH');

    const memoFixed = { ...allWrong, transaction: { memo: 'INV-2K4H9' } };
    assert.equal(codeOf(verifyHorizonPayment(memoFixed)), 'DESTINATION_MISMATCH');

    const destinationFixed = {
      ...memoFixed,
      operations: [
        paymentOp({
          amount: '1',
          asset_type: 'credit_alphanum4',
          asset_code: 'USDC',
          asset_issuer: USDC_ISSUER,
        }),
      ],
    };
    assert.equal(codeOf(verifyHorizonPayment(destinationFixed)), 'AMOUNT_MISMATCH');

    const amountFixed = {
      ...memoFixed,
      operations: [
        paymentOp({
          asset_type: 'credit_alphanum4',
          asset_code: 'USDC',
          asset_issuer: USDC_ISSUER,
        }),
      ],
    };
    assert.equal(codeOf(verifyHorizonPayment(amountFixed)), 'ASSET_MISMATCH');
  });
});

describe('checkTxHash', () => {
  it('accepts and trims a well-formed hash', () => {
    const result = checkTxHash(`  ${TX_HASH}  `);

    assert.equal(result.ok, true);
    assert.equal(result.ok ? result.value : '', TX_HASH);
  });

  it('rejects missing, blank, and non-string hashes', () => {
    for (const value of [undefined, null, '', '   ', 42, {}]) {
      const result = checkTxHash(value);
      assert.equal(result.ok, false);
      assert.equal(result.ok ? '' : result.code, 'MISSING_TX_HASH');
    }
  });

  it('rejects hashes of the wrong length', () => {
    assert.equal(isValidTxHash('a'.repeat(63)), false);
    assert.equal(isValidTxHash('a'.repeat(65)), false);
    assert.equal(isValidTxHash(TX_HASH.toUpperCase()), true);
  });
});

describe('checkInvoiceIsPayable', () => {
  it('allows only a pending invoice to reach PAID', () => {
    assert.equal(checkInvoiceIsPayable('PENDING').ok, true);

    const paid = checkInvoiceIsPayable('PAID');
    assert.equal(paid.ok, false);
    assert.equal(paid.ok ? '' : paid.code, 'INVOICE_ALREADY_PAID');

    const expired = checkInvoiceIsPayable('EXPIRED');
    assert.equal(expired.ok, false);
    assert.equal(expired.ok ? '' : expired.code, 'INVOICE_EXPIRED');
    assert.equal(expired.ok ? '' : expired.error, 'Invoice has expired and can no longer accept payment');

    const cancelled = checkInvoiceIsPayable('CANCELLED');
    assert.equal(cancelled.ok, false);
    assert.equal(cancelled.ok ? '' : cancelled.code, 'INVOICE_NOT_PENDING');
  });
});

describe('checkPayerInfo', () => {
  it('normalizes optional payer fields', () => {
    const result = checkPayerInfo({ payerName: '  Ada  ', payerEmail: ' ada@example.com ' });

    assert.equal(result.ok, true);
    assert.deepEqual(result.ok ? result.value : null, {
      payerName: 'Ada',
      payerEmail: 'ada@example.com',
    });
  });

  it('treats absent and blank payer fields as undefined', () => {
    const result = checkPayerInfo({ payerName: '   ' });

    assert.equal(result.ok, true);
    assert.deepEqual(result.ok ? result.value : null, {
      payerName: undefined,
      payerEmail: undefined,
    });
  });

  it('rejects a malformed email and oversized fields', () => {
    const badEmail = checkPayerInfo({ payerEmail: 'not-an-email' });
    assert.equal(badEmail.ok, false);
    assert.equal(badEmail.ok ? '' : badEmail.code, 'INVALID_PAYER_EMAIL');

    const tooLong = checkPayerInfo({ payerName: 'a'.repeat(256) });
    assert.equal(tooLong.ok, false);
    assert.equal(tooLong.ok ? '' : tooLong.code, 'PAYER_INFO_TOO_LONG');

    const notText = checkPayerInfo({ payerName: 42 } as any);
    assert.equal(notText.ok, false);
    assert.equal(notText.ok ? '' : notText.code, 'INVALID_PAYER_NAME');
  });
});

describe('shared contract', () => {
  it('matches the client mirror code for code and message for message', () => {
    // Acceptance criterion 1: every verify path must reject with equivalent
    // messages, so the frontend copy of the table cannot drift from this one.
    const clientVerification = require('../../frontend/lib/verification.js');

    assert.deepEqual(clientVerification.VERIFICATION_MESSAGES, VERIFICATION_MESSAGES);
  });

  it('every rejection code resolves to a non-empty message', () => {
    assert.deepEqual(Object.keys(VERIFICATION_MESSAGES), VERIFICATION_CODES);
    for (const code of VERIFICATION_CODES) {
      assert.equal(typeof VERIFICATION_MESSAGES[code], 'string');
      assert.ok(VERIFICATION_MESSAGES[code].length > 0, `${code} has no message`);
      assert.equal(messageForCode(code), VERIFICATION_MESSAGES[code]);
    }
  });
});
