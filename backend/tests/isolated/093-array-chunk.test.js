import test from 'node:test';
import assert from 'node:assert/strict';

const chunkByTwo = (values) =>
  Array.from({ length: Math.ceil(values.length / 2) }, (_, index) =>
    values.slice(index * 2, index * 2 + 2),
  );

test('chunks an even-length array into pairs', () => {
  assert.deepEqual(chunkByTwo([1, 2, 3, 4]), [[1, 2], [3, 4]]);
});

test('keeps an odd final item and handles an empty array', () => {
  assert.deepEqual(chunkByTwo([1, 2, 3]), [[1, 2], [3]]);
  assert.deepEqual(chunkByTwo([]), []);
});
