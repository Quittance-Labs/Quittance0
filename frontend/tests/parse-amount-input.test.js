const test = require('node:test');
const assert = require('node:assert/strict');
const { parseAmountInput } = require('../lib/parse-amount-input.ts');
const { parseAmountInputFixture } = require('./fixtures/parse-amount-input.fixture');

for (const { name, input, expected } of parseAmountInputFixture) {
  test(`parseAmountInput ${name}`, () => {
    assert.equal(parseAmountInput(input), expected);
  });
}
