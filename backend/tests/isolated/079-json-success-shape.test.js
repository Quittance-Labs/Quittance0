const test = require('node:test');
const assert = require('node:assert/strict');

function successResponse(data) {
  return { success: true, data };
}

test('returns a success response with data', () => {
  const data = { id: 'invoice-1' };

  assert.deepEqual(successResponse(data), { success: true, data });
});

test('preserves a null data payload', () => {
  assert.deepEqual(successResponse(null), { success: true, data: null });
});
