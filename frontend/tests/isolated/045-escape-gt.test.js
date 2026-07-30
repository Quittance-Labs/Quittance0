const test = require('node:test');
const assert = require('node:assert/strict');

function escapeGreaterThan(value) {
  return value.replace(/>/g, '&gt;');
}

test('escapes every greater-than character', () => {
  assert.equal(escapeGreaterThan('4 > 3 > 2'), '4 &gt; 3 &gt; 2');
});

test('leaves text without greater-than unchanged', () => {
  assert.equal(escapeGreaterThan('plain text'), 'plain text');
});
