const test = require('node:test');
const assert = require('node:assert/strict');

function escapeLessThan(value) {
  return value.replace(/</g, '&lt;');
}

test('escapes every less-than character', () => {
  assert.equal(escapeLessThan('2 < 3 < 4'), '2 &lt; 3 &lt; 4');
});

test('leaves text without less-than unchanged', () => {
  assert.equal(escapeLessThan('plain text'), 'plain text');
});
