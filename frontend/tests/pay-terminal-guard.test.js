const test = require('node:test');
const assert = require('node:assert/strict');
const { isTerminalPayState } = require('../lib/pay-terminal-guard.ts');
const { payTerminalGuardFixture } = require('./fixtures/pay-terminal-guard.fixture');

for (const { name, status, expected } of payTerminalGuardFixture) {
  test(`isTerminalPayState ${name}`, () => {
    assert.equal(isTerminalPayState(status), expected);
  });
}
