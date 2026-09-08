const test = require('node:test');
const assert = require('node:assert/strict');
const { statusLabel } = require('../lib/invoice-status-label.ts');
const { statusLabelFixture } = require('./fixtures/invoice-status-label.fixture');

for (const { input, expected } of statusLabelFixture) {
  test(`statusLabel maps ${JSON.stringify(input)} to ${expected}`, () => {
    assert.equal(statusLabel(input), expected);
  });
}
