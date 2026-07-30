import test from 'node:test';
import assert from 'node:assert/strict';

const isParseableDate = (value) => !Number.isNaN(Date.parse(value));

test('accepts an ISO timestamp', () => {
  assert.equal(isParseableDate('2026-07-28T12:34:56.000Z'), true);
});

test('rejects a non-date string', () => {
  assert.equal(isParseableDate('not-an-iso-date'), false);
});
