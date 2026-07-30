const test = require('node:test');
const assert = require('node:assert/strict');

const clampPercent = (value) => Math.min(100, Math.max(0, value));

test('keeps a percent already inside the allowed range', () => {
  assert.equal(clampPercent(42), 42);
});

test('clamps percentages to the range boundaries', () => {
  assert.equal(clampPercent(-5), 0);
  assert.equal(clampPercent(150), 100);
});
