import test from 'node:test';
import assert from 'node:assert/strict';

const expiresAfterCreated = (createdAt, expiresAt) =>
  Date.parse(expiresAt) > Date.parse(createdAt);

test('accepts an expiry after the creation time', () => {
  assert.equal(
    expiresAfterCreated('2026-07-28T12:00:00Z', '2026-07-29T12:00:00Z'),
    true,
  );
});

test('rejects equal and earlier expiry times', () => {
  assert.equal(
    expiresAfterCreated('2026-07-28T12:00:00Z', '2026-07-28T12:00:00Z'),
    false,
  );
  assert.equal(
    expiresAfterCreated('2026-07-28T12:00:00Z', '2026-07-27T12:00:00Z'),
    false,
  );
});
