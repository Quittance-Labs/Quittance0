const test = require('node:test');
const assert = require('node:assert/strict');
const { invoiceSharePath } = require('../lib/invoice-share-path');
const { invoiceSharePathFixture } = require('./fixtures/invoice-share-path.fixture');

for (const { input, output } of invoiceSharePathFixture) {
  test(`invoiceSharePath builds ${output} for ${JSON.stringify(input)}`, () => {
    assert.equal(invoiceSharePath(input), output);
  });
}

test('invoiceSharePath encodes reserved URL characters', () => {
  assert.equal(invoiceSharePath('a/b?c'), '/pay/a%2Fb%3Fc');
});
