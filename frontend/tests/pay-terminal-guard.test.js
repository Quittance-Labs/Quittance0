const test = require('node:test');
const assert = require('node:assert/strict');
const { isTerminalPayState } = require('../lib/pay-terminal-guard.ts');
const { payTerminalGuardFixture } = require('./fixtures/pay-terminal-guard.fixture.js');

for (const { input, expected } of payTerminalGuardFixture) {
  test(`isTerminalPayState returns ${expected} for ${JSON.stringify(input)}`, () => {
    assert.equal(isTerminalPayState(input), expected);
  });
}

test('isTerminalPayState handles whitespace and casing cleanly', () => {
  assert.equal(isTerminalPayState('  PAID  '), true);
  assert.equal(isTerminalPayState('  Expired  '), true);
  assert.equal(isTerminalPayState('  Cancelled  '), true);
});

test('isTerminalPayState handles invalid object or non-string inputs safely', () => {
  assert.equal(isTerminalPayState(12345), false);
  assert.equal(isTerminalPayState(true), false);
  assert.equal(isTerminalPayState({}), false);
  assert.equal(isTerminalPayState({ status: null }), false);
  assert.equal(isTerminalPayState({ status: 123 }), false);
});
