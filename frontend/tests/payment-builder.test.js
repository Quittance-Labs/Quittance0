const test = require('node:test');
const assert = require('node:assert/strict');
const {
  isValidStellarPublicKey,
  getUtf8ByteLength,
  validatePaymentInvoice,
  buildPaymentSummary,
  classifyPaymentError,
  buildAndSubmitFreighterPayment,
  BASE_FEE_XLM,
} = require('../lib/payment-builder.ts');

const VALID_DESTINATION = 'GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ';
const VALID_ISSUER = 'GCFXHS4GXL6BVUCXBWXGTITROWLVYXQKQLF4YH5O5JT3YZXCYPAFBJZB';
const VALID_MEMO = 'INV-2026-001';

test('isValidStellarPublicKey checks Stellar public key formatting', () => {
  assert.equal(isValidStellarPublicKey(VALID_DESTINATION), true);
  assert.equal(isValidStellarPublicKey(VALID_ISSUER), true);
  assert.equal(isValidStellarPublicKey(''), false);
  assert.equal(isValidStellarPublicKey(null), false);
  assert.equal(isValidStellarPublicKey(undefined), false);
  assert.equal(isValidStellarPublicKey('12345'), false);
  assert.equal(
    isValidStellarPublicKey('SA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ'),
    false
  );
  assert.equal(
    isValidStellarPublicKey('GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSG'),
    false
  );
});

test('getUtf8ByteLength accurately computes utf-8 byte size', () => {
  assert.equal(getUtf8ByteLength('hello'), 5);
  assert.equal(getUtf8ByteLength('INV-001'), 7);
  assert.equal(getUtf8ByteLength('28byteslongstringformemo1234'), 28);
  assert.equal(getUtf8ByteLength('29byteslongstringformemo12345'), 29);
});

test('validatePaymentInvoice validates valid XLM payment parameters', () => {
  const res = validatePaymentInvoice({
    destination: VALID_DESTINATION,
    amount: '100.5',
    memo: VALID_MEMO,
    assetCode: 'XLM',
  });
  assert.equal(res.valid, true);
  assert.equal(res.error, undefined);
});

test('validatePaymentInvoice validates valid USDC payment parameters with issuer', () => {
  const res = validatePaymentInvoice({
    destination: VALID_DESTINATION,
    amount: '50.25',
    memo: VALID_MEMO,
    assetCode: 'USDC',
    assetIssuer: VALID_ISSUER,
  });
  assert.equal(res.valid, true);
  assert.equal(res.error, undefined);
});

test('validatePaymentInvoice rejects missing or invalid destination', () => {
  const missing = validatePaymentInvoice({
    destination: '',
    amount: '10',
    memo: VALID_MEMO,
  });
  assert.equal(missing.valid, false);
  assert.match(missing.error, /destination address is required/i);

  const invalid = validatePaymentInvoice({
    destination: 'INVALID_PUBLIC_KEY',
    amount: '10',
    memo: VALID_MEMO,
  });
  assert.equal(invalid.valid, false);
  assert.match(invalid.error, /valid 56-character Stellar public key/i);
});

test('validatePaymentInvoice rejects zero, negative, or invalid amounts', () => {
  const zero = validatePaymentInvoice({
    destination: VALID_DESTINATION,
    amount: '0',
    memo: VALID_MEMO,
  });
  assert.equal(zero.valid, false);

  const negative = validatePaymentInvoice({
    destination: VALID_DESTINATION,
    amount: '-15.5',
    memo: VALID_MEMO,
  });
  assert.equal(negative.valid, false);

  const tooManyDecimals = validatePaymentInvoice({
    destination: VALID_DESTINATION,
    amount: '10.12345678',
    memo: VALID_MEMO,
  });
  assert.equal(tooManyDecimals.valid, false);
});

test('validatePaymentInvoice enforces memo presence, max 28 bytes, and exact match', () => {
  const missing = validatePaymentInvoice({
    destination: VALID_DESTINATION,
    amount: '10',
    memo: '',
  });
  assert.equal(missing.valid, false);
  assert.match(missing.error, /memo is required/i);

  const tooLong = validatePaymentInvoice({
    destination: VALID_DESTINATION,
    amount: '10',
    memo: 'This memo string is way longer than twenty-eight bytes',
  });
  assert.equal(tooLong.valid, false);
  assert.match(tooLong.error, /exceeds maximum length of 28/i);

  const mismatch = validatePaymentInvoice({
    destination: VALID_DESTINATION,
    amount: '10',
    memo: 'INV-WRONG-MEMO',
    invoiceMemo: 'INV-EXPECTED-MEMO',
  });
  assert.equal(mismatch.valid, false);
  assert.match(mismatch.error, /does not match invoice memo/i);

  const match = validatePaymentInvoice({
    destination: VALID_DESTINATION,
    amount: '10',
    memo: 'INV-EXPECTED-MEMO',
    invoiceMemo: 'INV-EXPECTED-MEMO',
  });
  assert.equal(match.valid, true);
});

test('validatePaymentInvoice requires issuer for non-XLM asset', () => {
  const missingIssuer = validatePaymentInvoice({
    destination: VALID_DESTINATION,
    amount: '25',
    memo: VALID_MEMO,
    assetCode: 'USDC',
  });
  assert.equal(missingIssuer.valid, false);
  assert.match(missingIssuer.error, /issuer public key is required/i);

  const invalidIssuer = validatePaymentInvoice({
    destination: VALID_DESTINATION,
    amount: '25',
    memo: VALID_MEMO,
    assetCode: 'USDC',
    assetIssuer: 'BAD_ISSUER',
  });
  assert.equal(invalidIssuer.valid, false);
});

test('buildPaymentSummary formats review summary with correct precision and fee', () => {
  const summary = buildPaymentSummary(
    {
      destination: VALID_DESTINATION,
      amount: '42.5',
      memo: 'PAY-REF-123',
      assetCode: 'xlm',
    },
    'TESTNET'
  );

  assert.equal(summary.destination, VALID_DESTINATION);
  assert.equal(summary.shortDestination, 'GA7QYN...UJVSGZ');
  assert.equal(summary.amount, '42.5000000');
  assert.equal(summary.numericAmount, 42.5);
  assert.equal(summary.assetCode, 'XLM');
  assert.equal(summary.memo, 'PAY-REF-123');
  assert.equal(summary.network, 'Testnet');
  assert.equal(summary.fee, BASE_FEE_XLM);
});

test('classifyPaymentError distinguishes transport, wallet, and verification errors', () => {
  const outage = classifyPaymentError(new Error('Stellar Horizon is temporarily unreachable.'));
  assert.equal(outage.type, 'TRANSPORT_ERROR');
  assert.equal(outage.retryable, true);

  const timeout = classifyPaymentError(new Error('ETIMEDOUT: network request timed out'));
  assert.equal(timeout.type, 'TRANSPORT_ERROR');
  assert.equal(timeout.retryable, true);

  const cancelled = classifyPaymentError(new Error('User declined transaction signature'));
  assert.equal(cancelled.type, 'WALLET_REJECTED');
  assert.equal(cancelled.retryable, true);

  const wrongNet = classifyPaymentError(
    new Error('Switch Freighter to Testnet to create or pay invoices.')
  );
  assert.equal(wrongNet.type, 'NETWORK_MISMATCH');
  assert.equal(wrongNet.retryable, true);

  const trustline = classifyPaymentError(new Error('op_no_trust'));
  assert.equal(trustline.type, 'TRUSTLINE_REQUIRED');

  const underfunded = classifyPaymentError(new Error('op_underfunded: Account needs funding'));
  assert.equal(underfunded.type, 'ACCOUNT_UNFUNDED');

  const verifyReject = classifyPaymentError(new Error('VERIFICATION: memo_mismatch on ledger'));
  assert.equal(verifyReject.type, 'VERIFICATION_REJECTED');
  assert.equal(verifyReject.retryable, false);
});

test('buildAndSubmitFreighterPayment blocks on wrong network before build', async () => {
  await assert.rejects(
    async () => {
      await buildAndSubmitFreighterPayment(
        {
          destination: VALID_DESTINATION,
          amount: '10',
          memo: VALID_MEMO,
        },
        {
          freighterAvailable: true,
          connected: true,
          publicKey: VALID_DESTINATION,
          network: 'PUBLIC',
        }
      );
    },
    (err) => {
      assert.match(err.message, /switch freighter to testnet/i);
      return true;
    }
  );
});

test('buildAndSubmitFreighterPayment blocks if memo does not match invoice', async () => {
  await assert.rejects(
    async () => {
      await buildAndSubmitFreighterPayment(
        {
          destination: VALID_DESTINATION,
          amount: '10',
          memo: 'WRONG_MEMO',
          invoiceMemo: 'CORRECT_MEMO',
        },
        {
          freighterAvailable: true,
          connected: true,
          publicKey: VALID_DESTINATION,
          network: 'TESTNET',
        }
      );
    },
    (err) => {
      assert.match(err.message, /does not match invoice memo/i);
      return true;
    }
  );
});
