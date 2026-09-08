const test = require('node:test');
const assert = require('node:assert/strict');
const { expirySummary } = require('../lib/card-expiry-summary');
const { cardExpirySummaryFixture } = require('./fixtures/card-expiry-summary.fixture');

for (const { input, expected } of cardExpirySummaryFixture) {
  test(`expirySummary formats ${input}`, () => {
    assert.equal(expirySummary(input), expected);
  });
}
