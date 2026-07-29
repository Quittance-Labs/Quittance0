const test = require('node:test');
const assert = require('node:assert/strict');

function isUuidV4(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

test('accepts a UUID v4 value', () => {
  assert.equal(isUuidV4('550e8400-e29b-41d4-a716-446655440000'), true);
});

test('rejects wrong-version and malformed UUID values', () => {
  assert.equal(isUuidV4('550e8400-e29b-31d4-a716-446655440000'), false);
  assert.equal(isUuidV4('550e8400e29b41d4a716446655440000'), false);
});
