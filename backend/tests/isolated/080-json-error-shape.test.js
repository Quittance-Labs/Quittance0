const test = require('node:test');
const assert = require('node:assert/strict');

function createErrorResponse(error) {
  return { success: false, error };
}

test('creates the ApiResponse error shape', () => {
  const response = createErrorResponse('Invoice not found');

  assert.deepEqual(response, {
    success: false,
    error: 'Invoice not found',
  });
  assert.equal('data' in response, false);
});

test('preserves an empty error message in the response shape', () => {
  assert.deepEqual(createErrorResponse(''), {
    success: false,
    error: '',
  });
});
