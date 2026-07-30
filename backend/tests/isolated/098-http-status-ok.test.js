import test from 'node:test';
import assert from 'node:assert/strict';

const isOkStatus = (status) => Number.isInteger(status) && status >= 200 && status <= 299;

test('accepts the inclusive successful HTTP status range', () => {
  assert.equal(isOkStatus(200), true);
  assert.equal(isOkStatus(299), true);
});

test('rejects statuses outside the successful range', () => {
  assert.equal(isOkStatus(199), false);
  assert.equal(isOkStatus(300), false);
});
