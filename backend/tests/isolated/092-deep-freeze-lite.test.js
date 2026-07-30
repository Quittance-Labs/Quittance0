import test from 'node:test';
import assert from 'node:assert/strict';

const freezeShallow = (value) => Object.freeze(value);

test('freezes the top-level object', () => {
  const frozen = freezeShallow({ status: 'PENDING' });
  assert.equal(Object.isFrozen(frozen), true);
});

test('leaves a nested object unfrozen', () => {
  const frozen = freezeShallow({ metadata: { memo: 'invoice-1' } });
  assert.equal(Object.isFrozen(frozen.metadata), false);
});
