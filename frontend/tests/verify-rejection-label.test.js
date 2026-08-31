const test = require('node:test');
const assert = require('node:assert/strict');
const {
  KNOWN_CODE_FIXTURES,
  UNKNOWN_CODE_FIXTURES,
} = require('./fixtures/verify-rejection-label.fixture');

const { rejectionLabel, REJECTION_LABELS } = require('../lib/verify-rejection-label.ts');

const GENERIC = 'Unknown verification error';

test('REJECTION_LABELS map contains exactly the 16 keys the contract declares', () => {
  assert.equal(typeof REJECTION_LABELS, 'object');
  assert.equal(
    Object.keys(REJECTION_LABELS).length,
    16,
    '15 known codes + 1 UNKNOWN_VERIFICATION_ERROR sentinel'
  );
});

test('rejectionLabel maps every known verification code to its short label', () => {
  for (const fixture of KNOWN_CODE_FIXTURES) {
    const label = rejectionLabel(fixture.code);
    assert.equal(label, fixture.label, `label mismatch for code=${fixture.code}`);
  }
});

test('rejectionLabel never returns an empty string or undefined', () => {
  for (const fixture of KNOWN_CODE_FIXTURES) {
    const label = rejectionLabel(fixture.code);
    assert.equal(typeof label, 'string');
    assert.notEqual(label.length, 0, `code=${fixture.code} must not be empty`);
  }
});

test('rejectionLabel falls back to the generic label for unknown / missing input', () => {
  for (const fixture of UNKNOWN_CODE_FIXTURES) {
    assert.equal(
      rejectionLabel(fixture.code),
      GENERIC,
      `expected generic label for ${fixture.name}`
    );
  }
});

test('rejectionLabel uses the caller-provided fallback when the code is unknown', () => {
  const custom = 'Please try another payment';
  for (const fixture of UNKNOWN_CODE_FIXTURES) {
    assert.equal(rejectionLabel(fixture.code, custom), custom, fixture.name);
  }
});

test('rejectionLabel ignores the fallback for known codes (labels are pinned)', () => {
  const custom = 'Should never appear for a known code';
  for (const fixture of KNOWN_CODE_FIXTURES) {
    assert.equal(
      rejectionLabel(fixture.code, custom),
      fixture.label,
      `known code ${fixture.code} must still return its pinned label`
    );
  }
});

test('rejectionLabel treats numeric / object codes as unknown (type guard)', () => {
  assert.equal(rejectionLabel(0), GENERIC);
  assert.equal(rejectionLabel({}), GENERIC);
  assert.equal(rejectionLabel([]), GENERIC);
});

test('labels are strictly shorter than the VERIFICATION_MESSAGES equivalent (UI badge contract)', () => {
  const { VERIFICATION_MESSAGES } = require('../lib/verification');
  for (const fixture of KNOWN_CODE_FIXTURES) {
    const message = VERIFICATION_MESSAGES[fixture.code];
    assert.equal(typeof message, 'string', `VERIFICATION_MESSAGES missing ${fixture.code}`);
    assert.ok(
      fixture.label.length <= message.length,
      `label for ${fixture.code} is not shorter than or equal to its message`
    );
  }
});

module.exports = rejectionLabel;
