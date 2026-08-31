const test = require('node:test');
const assert = require('node:assert/strict');
const { parseInvoiceAmount } = require('../lib/invoice-amount-parser');
const { invoiceAmountParserFixture } = require('./fixtures/invoice-amount-parser.fixture');

for (const { name, input, expected } of invoiceAmountParserFixture) {
  test(`parseInvoiceAmount ${name}`, () => {
    assert.equal(parseInvoiceAmount(input), expected);
  });
}
