const test = require('node:test');
const assert = require('node:assert/strict');
const { memoPaymentHint } = require('../lib/pay-memo-hint.ts');
const { payMemoHintFixture } = require('./fixtures/pay-memo-hint.fixture');

for (const { name, memo, expected } of payMemoHintFixture) {
  test(`memoPaymentHint ${name}`, () => {
    assert.equal(memoPaymentHint(memo), expected);
  });
}
