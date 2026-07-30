const test = require('node:test');
const assert = require('node:assert/strict');

const slugify = (title) => title.trim().toLowerCase().replace(/\s+/g, '-');

test('lowercases and dashes a short title', () => {
  assert.equal(slugify('Hello World'), 'hello-world');
});

test('trims and collapses repeated whitespace', () => {
  assert.equal(slugify('  One   More  '), 'one-more');
});
