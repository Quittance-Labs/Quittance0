const test = require('node:test');
const assert = require('node:assert/strict');
const { formatProofTimestamp } = require('../lib/proof-timestamp.ts');
const { proofTimestampFixture } = require('./fixtures/proof-timestamp.fixture');

for (const { name, input, expected } of proofTimestampFixture) {
  test(`formatProofTimestamp ${name}`, () => {
    assert.equal(formatProofTimestamp(input), expected);
  });
}
