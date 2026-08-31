const test = require('node:test');
const assert = require('node:assert/strict');
const { isTerminalPayStatus, TERMINAL_STATUSES } = require('../lib/pay-terminal-guard');
const { payTerminalGuardFixture } = require('./fixtures/pay-terminal-guard.fixture');

for (const { name, status, expected } of payTerminalGuardFixture) {
  test(`isTerminalPayStatus ${name}`, () => {
    assert.equal(isTerminalPayStatus(status), expected);
  });
}

test('TERMINAL_STATUSES contains expected values', () => {
  assert.ok(TERMINAL_STATUSES.has('PAID'));
  assert.ok(TERMINAL_STATUSES.has('EXPIRED'));
  assert.ok(TERMINAL_STATUSES.has('CANCELLED'));
});
