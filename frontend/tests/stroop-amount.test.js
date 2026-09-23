const test = require('node:test');
const assert = require('node:assert/strict');
const {
  STROOP_DECIMALS,
  parseStroops,
  formatStroops,
  canonicalAmount,
  amountsEqual,
} = require('../lib/stroop-amount.js');

test('STROOP_DECIMALS is 7', () => {
  assert.equal(STROOP_DECIMALS, 7);
});

test('parseStroops accepts numeric and string amounts', () => {
  assert.equal(parseStroops('0.0000001'), 1n);
  assert.equal(parseStroops(0.0000001), 1n);
  assert.equal(parseStroops(1e-7), 1n);
  assert.equal(parseStroops('10.0000000'), 100_000_000n);
  assert.equal(parseStroops('0042.5000000'), 425_000_000n);
  assert.equal(parseStroops('10'), 100_000_000n);
});

test('parseStroops rejects invalid input', () => {
  for (const bad of ['', '   ', 'abc', '1.2.3', '-1', -5, NaN, Infinity, null, undefined, {}]) {
    assert.equal(parseStroops(bad), null, `expected null for ${String(bad)}`);
  }
});

test('formatStroops emits seven decimals', () => {
  assert.equal(formatStroops(1n), '0.0000001');
  assert.equal(formatStroops(100_000_000n), '10.0000000');
  assert.equal(formatStroops(0n), '0.0000000');
});

test('canonicalAmount round-trips mixed representations to one string', () => {
  assert.equal(canonicalAmount(0.0000001), '0.0000001');
  assert.equal(canonicalAmount(1e-7), '0.0000001');
  assert.equal(canonicalAmount(10), '10.0000000');
  assert.equal(canonicalAmount('10.0000000'), '10.0000000');
  assert.equal(canonicalAmount('  0042.5000000 '), '42.5000000');
  assert.equal(canonicalAmount('abc'), null);
});

test('amountsEqual is stroop-exact', () => {
  assert.equal(amountsEqual('10.0000000', 10), true);
  assert.equal(amountsEqual('0.0000001', 1e-7), true);
  assert.equal(amountsEqual('10.0000000', '9.9999999'), false);
  assert.equal(amountsEqual('10.0000000', 'abc'), false);
});
