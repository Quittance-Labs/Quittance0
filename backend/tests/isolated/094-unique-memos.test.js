import test from 'node:test';
import assert from 'node:assert/strict';

const hasDuplicateMemos = (memos) => new Set(memos).size !== memos.length;

test('detects a repeated memo in a collection', () => {
  assert.equal(hasDuplicateMemos(['invoice-1', 'invoice-1']), true);
});

test('accepts unique and empty memo collections', () => {
  assert.equal(hasDuplicateMemos(['invoice-1', 'invoice-2']), false);
  assert.equal(hasDuplicateMemos([]), false);
});
