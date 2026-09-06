const test = require('node:test');
const assert = require('node:assert/strict');
const { mapApiError } = require('../lib/api-error-message.ts');
const { apiErrorMessageFixture } = require('./fixtures/api-error-message.fixture.js');

for (const { input, expected } of apiErrorMessageFixture) {
  test(`mapApiError returns "${expected}" for fixture test`, () => {
    assert.equal(mapApiError(input), expected);
  });
}

test('mapApiError respects custom fallback string', () => {
  assert.equal(mapApiError(null, 'Custom error message'), 'Custom error message');
  assert.equal(mapApiError({}, 'Failed to fetch invoice'), 'Failed to fetch invoice');
});

test('mapApiError prioritizes server error message over transport error', () => {
  const error = {
    response: { data: { error: 'Server validation failed' } },
    message: 'Network Error',
  };
  assert.equal(mapApiError(error), 'Server validation failed');
});
