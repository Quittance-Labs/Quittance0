const test = require('node:test');
const assert = require('node:assert/strict');

function escapeAmpersands(value) {
  return value.replace(/&/g, '&amp;');
}

test('escapes every ampersand', () => {
  assert.equal(escapeAmpersands('R&D & QA'), 'R&amp;D &amp; QA');
});

test('leaves text without ampersands unchanged', () => {
  assert.equal(escapeAmpersands('plain text'), 'plain text');
});
