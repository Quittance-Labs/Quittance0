import test from 'node:test';
import assert from 'node:assert/strict';

const defaultAmount = (value) => value ?? 0;

test('defaults nullish amount values to zero', () => {
  assert.equal(defaultAmount(undefined), 0);
  assert.equal(defaultAmount(null), 0);
});

test('preserves a supplied amount including zero', () => {
  assert.equal(defaultAmount(25), 25);
  assert.equal(defaultAmount(0), 0);
});
