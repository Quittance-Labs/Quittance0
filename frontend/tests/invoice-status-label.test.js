const test = require('node:test');
const assert = require('node:assert/strict');
const { statusLabel } = require('../lib/invoice-status-label');
const {
  VALID_CASES,
  INVALID_CASES,
} = require('./fixtures/invoice-status-label.fixture');

for (const { status, expected } of VALID_CASES) {
  test(`statusLabel('${status}') returns '${expected}'`, () => {
    assert.equal(statusLabel(status), expected);
  });
}

for (const { status, expected } of INVALID_CASES) {
  test(`statusLabel(${JSON.stringify(status)}) returns '${expected}'`, () => {
    assert.equal(statusLabel(status), expected);
  });
}
