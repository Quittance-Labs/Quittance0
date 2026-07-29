const test = require('node:test');
const assert = require('node:assert/strict');

function clampQueryLimit(limit) {
  return Math.min(100, Math.max(1, limit));
}

test('preserves query limits within 1..100', () => {
  assert.equal(clampQueryLimit(1), 1);
  assert.equal(clampQueryLimit(50), 50);
  assert.equal(clampQueryLimit(100), 100);
});

test('clamps query limits to the 1..100 boundaries', () => {
  assert.equal(clampQueryLimit(0), 1);
  assert.equal(clampQueryLimit(-25), 1);
  assert.equal(clampQueryLimit(101), 100);
  assert.equal(clampQueryLimit(500), 100);
});
