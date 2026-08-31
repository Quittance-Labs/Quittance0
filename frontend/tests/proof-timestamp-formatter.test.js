const test = require('node:test');
const assert = require('node:assert/strict');
const { formatProofTimestamp } = require('../lib/proof-timestamp-formatter');
const { proofTimestampFormatterFixture } = require('./fixtures/proof-timestamp-formatter.fixture');

for (const { name, input, expected } of proofTimestampFormatterFixture) {
  test(`formatProofTimestamp ${name}`, () => {
    const result = formatProofTimestamp(input);
    if (expected === null) {
      assert.equal(result, null);
    } else {
      assert.ok(result.includes(expected));
    }
  });
}
