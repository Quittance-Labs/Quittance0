const test = require('node:test');
const assert = require('node:assert/strict');
const {
  ApiRequestError,
  ApiUnavailableError,
  apiErrorMessage,
  isApiUnavailableError,
  resolveApiConfig,
  toApiError,
} = require('../lib/api-runtime');
const { VERIFICATION_MESSAGES, messageForCode } = require('../lib/verification');

test('production API config requires HTTPS and an /api suffix', () => {
  assert.equal(resolveApiConfig('https://api.example.com/api/', 'production').baseUrl,
    'https://api.example.com/api');
  assert.equal(resolveApiConfig('http://api.example.com/api', 'production').configured, false);
  assert.equal(resolveApiConfig('https://api.example.com', 'production').configured, false);
});

test('missing production config fails visibly instead of pointing at visitor localhost', () => {
  const config = resolveApiConfig(undefined, 'production');
  assert.equal(config.configured, false);
  assert.match(config.error, /NEXT_PUBLIC_API_URL/);
  assert.doesNotMatch(config.baseUrl, /localhost/);
});

test('local development keeps the documented localhost fallback', () => {
  assert.equal(resolveApiConfig(undefined, 'development').baseUrl, 'http://localhost:3001/api');
});

test('network, timeout, and server failures normalize to a retryable offline error', () => {
  for (const error of [
    { code: 'ERR_NETWORK' },
    { code: 'ECONNABORTED' },
    { response: { status: 503 } },
  ]) {
    const normalized = toApiError(error);
    assert.ok(normalized instanceof ApiUnavailableError);
    assert.equal(isApiUnavailableError(normalized), true);
    assert.match(apiErrorMessage(normalized), /unreachable/i);
  }
});

test('backend validation responses retain their stable code and message', () => {
  const normalized = toApiError({
    response: { status: 400, data: { code: 'MEMO_MISMATCH', error: 'Memo mismatch' } },
  });
  assert.ok(normalized instanceof ApiRequestError);
  assert.equal(normalized.code, 'MEMO_MISMATCH');
  assert.equal(normalized.message, 'Memo mismatch');
});

test('a known verification code maps to the canonical message in the API layer', () => {
  // The dashboard, invoice detail and load-error banners render API errors
  // through apiErrorMessage. Every stable rejection code must surface the exact
  // canonical copy that the pay page (and the backend) use, so the server can
  // never show a stale or divergent string.
  for (const code of Object.keys(VERIFICATION_MESSAGES)) {
    const error = {
      response: { status: 400, data: { code, error: 'Server said no' } },
    };

    assert.equal(
      apiErrorMessage(error, 'Request failed'),
      VERIFICATION_MESSAGES[code],
      `${code} did not resolve to its canonical message`
    );
    assert.equal(messageForCode(code), VERIFICATION_MESSAGES[code]);
  }
});

test('apiErrorMessage prefers a canonical code over the server text', () => {
  const error = {
    response: { status: 400, data: { code: 'ASSET_MISMATCH', error: 'different wording' } },
  };

  assert.equal(apiErrorMessage(error), 'Asset mismatch');
});

test('an unknown verification code falls back to the server error text', () => {
  const error = {
    response: { status: 400, data: { code: 'SOMETHING_NEW', error: 'Server said no' } },
  };

  assert.equal(apiErrorMessage(error), 'Server said no');
  assert.equal(apiErrorMessage(error, 'Fallback'), 'Server said no');
});
