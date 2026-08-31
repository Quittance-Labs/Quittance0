const test = require('node:test');
const assert = require('node:assert/strict');
const { payMemoHint } = require('../lib/pay-memo-hint');
const { payMemoHintFixture } = require('./fixtures/pay-memo-hint.fixture');

for (const { name, memo, required, expected } of payMemoHintFixture) {
  test(`payMemoHint ${name}`, () => {
    assert.equal(payMemoHint(memo, required), expected);
  });
}
