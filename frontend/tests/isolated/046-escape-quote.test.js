const test = require('node:test');
const assert = require('node:assert/strict');

function escapeDoubleQuotes(value) {
  return value.replace(/"/g, '&quot;');
}

test('escapes every double quote', () => {
  assert.equal(escapeDoubleQuotes('say "hello" and "bye"'), 'say &quot;hello&quot; and &quot;bye&quot;');
});

test('leaves text without double quotes unchanged', () => {
  assert.equal(escapeDoubleQuotes('plain text'), 'plain text');
});
