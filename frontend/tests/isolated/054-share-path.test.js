const test = require('node:test');
const assert = require('node:assert/strict');

function buildPayPath(id) {
  if (!id || typeof id !== 'string') {
    throw new Error('Invalid id');
  }
  return `/pay/${encodeURIComponent(id)}`;
}

test('buildPayPath generates the correct path for a valid id', () => {
  const path = buildPayPath('12345');
  assert.equal(path, '/pay/12345');
});

test('buildPayPath throws an error for empty id', () => {
  assert.throws(() => buildPayPath(''), {
    message: 'Invalid id'
  });
});

test('buildPayPath URI encodes the id', () => {
  const path = buildPayPath('user 123');
  assert.equal(path, '/pay/user%20123');
});
