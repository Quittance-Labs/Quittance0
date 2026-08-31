const test = require('node:test');
const assert = require('node:assert/strict');
const { mapApiErrorMessage } = require('../lib/api-error-mapper');
const { apiErrorMapperFixture } = require('./fixtures/api-error-mapper.fixture');

for (const { name, error, expected } of apiErrorMapperFixture) {
  test(`mapApiErrorMessage ${name}`, () => {
    assert.equal(mapApiErrorMessage(error), expected);
  });
}
