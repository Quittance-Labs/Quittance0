const test = require('node:test');
const assert = require('node:assert/strict');

const uniqueIds = (ids) => [...new Set(ids)];

test('deduplicates repeated string ids', () => {
  assert.deepEqual(uniqueIds(['a', 'b', 'a']), ['a', 'b']);
});

test('keeps an empty id list empty', () => {
  assert.deepEqual(uniqueIds([]), []);
});
