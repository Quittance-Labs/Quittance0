const test = require('node:test');
const assert = require('node:assert/strict');
const { formatProofTimestamp } = require('../lib/proof-timestamp.ts');
const { proofTimestampFixture } = require('./fixtures/proof-timestamp.fixture.js');

for (const { input, expected } of proofTimestampFixture) {
  test(`formatProofTimestamp handles ${input} safely`, () => {
    assert.equal(formatProofTimestamp(input), expected);
  });
}

test('formatProofTimestamp formats Date instance with default pattern', () => {
  const d = new Date(2024, 0, 15, 12, 30, 0);
  const formatted = formatProofTimestamp(d);
  assert.ok(formatted.includes('2024'));
  assert.ok(formatted.includes('Jan'));
});

test('formatProofTimestamp supports custom pattern', () => {
  const d = new Date(2024, 0, 15, 12, 30, 0);
  const formatted = formatProofTimestamp(d, 'yyyy-MM-dd');
  assert.equal(formatted, '2024-01-15');
});

test('formatProofTimestamp supports numeric epoch timestamp', () => {
  const epoch = 1705312800000;
  const formatted = formatProofTimestamp(epoch, 'yyyy-MM-dd');
  assert.ok(formatted.startsWith('2024-01-'));
});
