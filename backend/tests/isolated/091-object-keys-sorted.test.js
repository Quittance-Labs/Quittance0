import test from 'node:test';
import assert from 'node:assert/strict';

const sortedKeys = (value) => Object.keys(value).sort();

test('returns object keys in alphabetical order', () => {
  assert.deepEqual(sortedKeys({ status: 'PAID', amount: '10', memo: 'm1' }), [
    'amount',
    'memo',
    'status',
  ]);
});

test('returns an empty list for an object without keys', () => {
  assert.deepEqual(sortedKeys({}), []);
});
