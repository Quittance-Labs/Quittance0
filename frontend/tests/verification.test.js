const test = require('node:test');
const assert = require('node:assert/strict');
const {
  VERIFICATION_MESSAGES,
  isValidTxHash,
  checkTxHash,
  checkPayerInfo,
  resolveVerificationError,
  normalizeTransactionHash,
} = require('../lib/verification');

const TX_HASH = 'a1b2c3d4'.repeat(8); // 64 hex characters

test('accepts a well-formed transaction hash and trims it', () => {
  const result = checkTxHash(`  ${TX_HASH}  `);

  assert.equal(result.ok, true);
  assert.equal(result.value, TX_HASH);
});

test('transaction hash normalization is safe for unknown input', () => {
  assert.equal(normalizeTransactionHash(`  ${TX_HASH}  `), TX_HASH);
  assert.equal(normalizeTransactionHash(null), '');
  assert.equal(normalizeTransactionHash({}), '');
});

test('rejects a missing transaction hash with the shared message', () => {
  for (const value of ['', '   ', undefined, null]) {
    const result = checkTxHash(value);
    assert.equal(result.ok, false);
    assert.equal(result.code, 'MISSING_TX_HASH');
    assert.equal(result.error, 'Transaction hash is required');
  }
});

test('rejects a malformed transaction hash before calling the API', () => {
  for (const value of ['not-a-hash', 'abc123', 'a'.repeat(63), 'z'.repeat(64)]) {
    const result = checkTxHash(value);
    assert.equal(result.ok, false);
    assert.equal(result.code, 'INVALID_TX_HASH');
  }

  assert.equal(isValidTxHash(TX_HASH.toUpperCase()), true);
  assert.equal(isValidTxHash('a'.repeat(65)), false);
});

test('normalizes payer info and rejects a malformed email', () => {
  const ok = checkPayerInfo({ payerName: '  Ada  ', payerEmail: ' ada@example.com ' });
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.value, { payerName: 'Ada', payerEmail: 'ada@example.com' });

  const badEmail = checkPayerInfo({ payerName: '', payerEmail: 'not-an-email' });
  assert.equal(badEmail.ok, false);
  assert.equal(badEmail.code, 'INVALID_PAYER_EMAIL');

  const tooLong = checkPayerInfo({ payerEmail: `${'a'.repeat(250)}@example.com` });
  assert.equal(tooLong.ok, false);
  assert.equal(tooLong.code, 'PAYER_INFO_TOO_LONG');
});

test('surfaces the server rejection code using the shared message', () => {
  const wrongAsset = { response: { data: { code: 'ASSET_MISMATCH', error: 'Asset mismatch' } } };
  assert.equal(resolveVerificationError(wrongAsset), 'Asset mismatch');

  const wrongDestination = { response: { data: { code: 'DESTINATION_MISMATCH' } } };
  assert.equal(resolveVerificationError(wrongDestination), 'Payment destination mismatch');

  const wrongNetwork = { response: { data: { code: 'NETWORK_MISMATCH' } } };
  assert.equal(
    resolveVerificationError(wrongNetwork),
    'Transaction is on a different Stellar network'
  );
});

test('falls back to server text, then the error message, then a default', () => {
  const unknownCode = { response: { data: { code: 'SOMETHING_NEW', error: 'Server said no' } } };
  assert.equal(resolveVerificationError(unknownCode), 'Server said no');

  assert.equal(resolveVerificationError(new Error('Network Error')), 'Network Error');
  assert.equal(resolveVerificationError({}), 'Verification failed');
  assert.equal(resolveVerificationError({}, 'Try again'), 'Try again');
});

test('covers every rejection code with a message', () => {
  const codes = [
    'MISSING_TX_HASH',
    'INVALID_TX_HASH',
    'INVALID_PAYER_NAME',
    'INVALID_PAYER_EMAIL',
    'PAYER_INFO_TOO_LONG',
    'INVOICE_ALREADY_PAID',
    'INVOICE_NOT_PENDING',
    'TRANSACTION_NOT_FOUND',
    'NO_PAYMENT_OPERATION',
    'MEMO_MISMATCH',
    'DESTINATION_MISMATCH',
    'AMOUNT_MISMATCH',
    'ASSET_MISMATCH',
    'NETWORK_MISMATCH',
  ];

  assert.deepEqual(Object.keys(VERIFICATION_MESSAGES).sort(), codes.sort());
  for (const code of codes) {
    assert.equal(typeof VERIFICATION_MESSAGES[code], 'string');
    assert.ok(VERIFICATION_MESSAGES[code].length > 0);
  }
});
