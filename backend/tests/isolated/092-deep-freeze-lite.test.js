const test = require('node:test');
const assert = require('node:assert/strict');

// Minimal in-file helper: shallow freeze an object and return it
function shallowFreeze(obj) {
  return Object.freeze(obj);
}

test('shallowFreeze helper', async (t) => {
  await t.test('frozen object rejects property mutation (happy path)', () => {
    const obj = shallowFreeze({ name: 'Quittance', amount: 100 });

    // In strict mode a throw is expected, but outside strict mode it silently fails.
    // Either way the value must NOT change.
    try { obj.name = 'changed'; } catch (_) { /* expected in strict mode */ }
    try { obj.amount = 999; } catch (_) { /* expected in strict mode */ }

    assert.equal(obj.name, 'Quittance');
    assert.equal(obj.amount, 100);
    assert.ok(Object.isFrozen(obj));
  });

  await t.test('freeze is shallow — nested object remains mutable (edge case)', () => {
    const inner = { value: 42 };
    const obj = shallowFreeze({ inner });

    // The outer object is frozen …
    assert.ok(Object.isFrozen(obj));

    // … but the nested object is NOT frozen by a shallow freeze.
    assert.ok(!Object.isFrozen(obj.inner));

    // So mutating the nested object succeeds without throwing.
    obj.inner.value = 99;
    assert.equal(obj.inner.value, 99);
  });

  await t.test('frozen object does not allow adding new properties (edge case)', () => {
    const obj = shallowFreeze({ status: 'PAID' });

    try { obj.extra = 'oops'; } catch (_) { /* expected in strict mode */ }

    assert.equal(obj.extra, undefined);
    assert.ok(Object.isFrozen(obj));
  });
});
