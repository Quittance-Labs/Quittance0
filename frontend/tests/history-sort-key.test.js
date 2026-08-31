const test = require('node:test');
const assert = require('node:assert/strict');
const { sortKeyForInvoice } = require('../lib/history-sort-key.ts');
const { historySortKeyFixture } = require('./fixtures/history-sort-key.fixture');

for (const { name, invoice, expected } of historySortKeyFixture) {
  test(`sortKeyForInvoice ${name}`, () => {
    assert.equal(sortKeyForInvoice(invoice), expected);
  });
}
