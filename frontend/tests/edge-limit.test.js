const test = require('node:test');
const assert = require('node:assert/strict');
const {
  isEdgeLimitError,
  edgeLimitMessage,
  EDGE_LIMIT_MESSAGES,
} = require('../lib/edge-limit.js');
const { toApiError, ApiRequestError } = require('../lib/api-runtime.js');
const { resolveVerificationError } = require('../lib/verification.js');
const { VERIFICATION_MESSAGES } = require('../lib/verification.js');

test('429 and 413 are edge limits, never payment rejections', () => {
  for (const status of [429, 413]) {
    assert.equal(isEdgeLimitError({ response: { status } }), true);
    assert.equal(isEdgeLimitError({ status }), true);
  }

  assert.equal(isEdgeLimitError({ response: { status: 400, data: { code: 'MEMO_MISMATCH' } } }), false);
  assert.equal(isEdgeLimitError({ response: { status: 400, data: { code: 'AMOUNT_MISMATCH' } } }), false);
  assert.equal(isEdgeLimitError({ response: { status: 400, data: { code: 'AMOUNT_TOO_LOW' } } }), false);
});

test('stable edge codes classify as edge limits regardless of status', () => {
  for (const code of [
    'RATE_LIMIT_EXCEEDED',
    'VERIFY_RATE_LIMIT_EXCEEDED',
    'VERIFY_IN_PROGRESS',
    'PAYLOAD_TOO_LARGE',
    'INVOICE_STORE_FULL',
  ]) {
    assert.equal(isEdgeLimitError({ code }), true);
    assert.equal(isEdgeLimitError({ response: { status: 200, data: { code } } }), true);
  }
});

test('edgeLimitMessage never returns a memo or amount rejection string', () => {
  const memo = VERIFICATION_MESSAGES.MEMO_MISMATCH;
  const amount = VERIFICATION_MESSAGES.AMOUNT_MISMATCH;

  const cases = [
    { response: { status: 429, data: { code: 'RATE_LIMIT_EXCEEDED', error: memo } } },
    { response: { status: 429, data: { code: 'VERIFY_RATE_LIMIT_EXCEEDED', error: amount } } },
    { response: { status: 413, data: { code: 'PAYLOAD_TOO_LARGE', error: memo } } },
    { status: 429 },
    { status: 413 },
  ];

  for (const error of cases) {
    const message = edgeLimitMessage(error);
    assert.notEqual(message, memo);
    assert.notEqual(message, amount);
    assert.match(message, /wait|too large|try again|in progress|verification attempts/i);
  }
});

test('toApiError marks 429 and 413 as retryable with edge copy', () => {
  const rate = toApiError({
    response: { status: 429, data: { code: 'RATE_LIMIT_EXCEEDED', error: 'Memo mismatch' } },
  });
  assert.ok(rate instanceof ApiRequestError);
  assert.equal(rate.retryable, true);
  assert.equal(rate.code, 'RATE_LIMIT_EXCEEDED');
  assert.equal(rate.message, EDGE_LIMIT_MESSAGES.RATE_LIMIT_EXCEEDED);
  assert.notEqual(rate.message, VERIFICATION_MESSAGES.MEMO_MISMATCH);

  const oversized = toApiError({
    response: { status: 413, data: { code: 'PAYLOAD_TOO_LARGE', error: 'Amount mismatch' } },
  });
  assert.ok(oversized instanceof ApiRequestError);
  assert.equal(oversized.retryable, true);
  assert.equal(oversized.code, 'PAYLOAD_TOO_LARGE');
  assert.equal(oversized.message, EDGE_LIMIT_MESSAGES.PAYLOAD_TOO_LARGE);
  assert.notEqual(oversized.message, VERIFICATION_MESSAGES.AMOUNT_MISMATCH);
});

test('resolveVerificationError routes 429/413 through edge copy', () => {
  const rate = {
    response: { status: 429, data: { code: 'RATE_LIMIT_EXCEEDED', error: 'Memo mismatch' } },
  };
  assert.equal(resolveVerificationError(rate), EDGE_LIMIT_MESSAGES.RATE_LIMIT_EXCEEDED);
  assert.notEqual(resolveVerificationError(rate), VERIFICATION_MESSAGES.MEMO_MISMATCH);

  const oversized = {
    response: { status: 413, data: { code: 'PAYLOAD_TOO_LARGE', error: 'Amount mismatch' } },
  };
  assert.equal(resolveVerificationError(oversized), EDGE_LIMIT_MESSAGES.PAYLOAD_TOO_LARGE);
});
