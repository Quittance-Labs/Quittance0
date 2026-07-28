import test from 'node:test';
import assert from 'node:assert/strict';

const containsAt = (value) => typeof value === 'string' && value.includes('@');

test('recognizes an email address with an at sign', () => {
  assert.equal(containsAt('buyer@example.com'), true);
});

test('rejects a value without an at sign', () => {
  assert.equal(containsAt('buyer.example.com'), false);
  assert.equal(containsAt(''), false);
});
