import test from 'node:test';
import assert from 'node:assert/strict';

const normalizeTruthyFlag = (value) =>
  typeof value === 'string' &&
  ['true', '1', 'yes', 'on'].includes(value.trim().toLowerCase());

test('normalizes common truthy string flags', () => {
  assert.equal(normalizeTruthyFlag('TRUE'), true);
  assert.equal(normalizeTruthyFlag(' yes '), true);
});

test('rejects false and non-string values', () => {
  assert.equal(normalizeTruthyFlag('false'), false);
  assert.equal(normalizeTruthyFlag(true), false);
});
