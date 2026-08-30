const test = require('node:test');
const assert = require('node:assert/strict');

function escapeApostrophes(value) {
  return value.replace(/'/g, '&#039;');
}

test('escapes every apostrophe', () => {
  assert.equal(escapeApostrophes("can't and won't"), 'can&#039;t and won&#039;t');
});

test('leaves text without apostrophes unchanged', () => {
  assert.equal(escapeApostrophes('plain text'), 'plain text');
});
