const test = require('node:test');
const assert = require('node:assert/strict');

// Minimal in-file helper: safely parse an amount string into a number.
// Returns NaN for empty/invalid input, strips currency symbols and
// thousands separators before parsing.
function safeParseAmount(input) {
  if (typeof input !== 'string' || input.trim() === '') {
    return NaN;
  }
  const cleaned = input.replace(/[$€£¥,\s]/g, '');
  const num = parseFloat(cleaned);
  return Number.isFinite(num) ? num : NaN;
}

test('parses a plain decimal amount string', () => {
  assert.strictEqual(safeParseAmount('123.45'), 123.45);
});

test('parses an integer amount string', () => {
  assert.strictEqual(safeParseAmount('42'), 42);
});

test('parses an amount with a currency symbol', () => {
  assert.strictEqual(safeParseAmount('$123.45'), 123.45);
  assert.strictEqual(safeParseAmount('€50'), 50);
});

test('parses an amount with thousands separators', () => {
  assert.strictEqual(safeParseAmount('1,234.56'), 1234.56);
});

test('parses an amount with surrounding whitespace', () => {
  assert.strictEqual(safeParseAmount('  99.99  '), 99.99);
});

test('returns NaN for an empty string', () => {
  assert.ok(Number.isNaN(safeParseAmount('')));
});

test('returns NaN for a non-numeric string', () => {
  assert.ok(Number.isNaN(safeParseAmount('abc')));
});

test('returns NaN for a non-string input', () => {
  assert.ok(Number.isNaN(safeParseAmount(null)));
  assert.ok(Number.isNaN(safeParseAmount(undefined)));
});