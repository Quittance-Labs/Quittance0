const test = require('node:test');
const assert = require('node:assert/strict');

const hasNonemptyText = (value) => value.trim().length > 0;

test('accepts a nonempty string', () => {
  assert.equal(hasNonemptyText('invoice'), true);
});

test('rejects empty and whitespace-only strings', () => {
  assert.equal(hasNonemptyText(''), false);
  assert.equal(hasNonemptyText('   '), false);
});
