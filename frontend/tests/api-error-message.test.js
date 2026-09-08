const test = require('node:test');
const assert = require('node:assert/strict');
const { mapApiError } = require('../lib/api-error-message.ts');
const { apiErrorMessageFixture } = require('./fixtures/api-error-message.fixture');

for (const { name, error, expected } of apiErrorMessageFixture) {
  test(`mapApiError ${name}`, () => {
    assert.equal(mapApiError(error), expected);
  });
}
