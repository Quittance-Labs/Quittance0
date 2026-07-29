const test = require('node:test');
const assert = require('node:assert/strict');

function hasSafeMemoCharset(value) {
  return /^[A-Z0-9-]+$/.test(value);
}

test('accepts generated-style memo characters', () => {
  assert.equal(hasSafeMemoCharset('INV-ABC123-XYZ789'), true);
});

test('rejects memo text containing an unsafe character', () => {
  assert.equal(hasSafeMemoCharset('INV-ABC 123-XYZ789'), false);
});
