const test = require('node:test');
const assert = require('node:assert/strict');
const { validateInvoiceMemoPrefix } = require('../lib/invoice-memo-prefix-validator');
const { invoiceMemoPrefixValidatorFixture } = require('./fixtures/invoice-memo-prefix-validator.fixture');

for (const { name, value, options, expected } of invoiceMemoPrefixValidatorFixture) {
  test(`validateInvoiceMemoPrefix ${name}`, () => {
    const result = validateInvoiceMemoPrefix(value, options);
    assert.deepEqual(result, expected);
  });
}
