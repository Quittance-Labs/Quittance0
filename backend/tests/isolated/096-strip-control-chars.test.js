import test from 'node:test';
import assert from 'node:assert/strict';

const stripAsciiControls = (value) => value.replace(/[\u0000-\u001F\u007F]/g, '');

test('removes ASCII control characters from text', () => {
  assert.equal(stripAsciiControls('memo\nwith\ttabs'), 'memowithtabs');
});

test('keeps ordinary printable text unchanged', () => {
  assert.equal(stripAsciiControls('invoice memo'), 'invoice memo');
});
