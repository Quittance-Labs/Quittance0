const test = require('node:test');
const assert = require('node:assert/strict');

/**
 * Minimal in-file helper: shallowFreeze wraps Object.freeze.
 * Freezes own enumerable properties at the top level only —
 * nested objects remain mutable (shallow, not deep).
 */
function shallowFreeze(obj) {
  return Object.freeze(obj);
}

// Happy path: top-level properties become read-only after freezing.
test('shallowFreeze — top-level properties are immutable', () => {
  const invoice = shallowFreeze({ id: 'inv-001', amount: 100 });

  // Attempting to mutate in strict mode throws; outside strict mode it silently
  // fails. Either way the value must NOT change.
  try { invoice.amount = 999; } catch (_) { /* strict mode: TypeError is fine */ }

  assert.equal(invoice.id, 'inv-001');
  assert.equal(invoice.amount, 100);
});

// Edge case: nested objects are NOT frozen (shallow only).
test('shallowFreeze — nested objects remain mutable (shallow, not deep)', () => {
  const config = shallowFreeze({ meta: { version: 1 } });

  // Top-level ref is frozen — cannot replace `meta` itself.
  try { config.meta = null; } catch (_) { /* expected in strict mode */ }
  assert.ok(config.meta !== null, 'top-level ref is still the original object');

  // But the nested object is NOT frozen, so its own props are writable.
  config.meta.version = 42;
  assert.equal(config.meta.version, 42);
});

// Edge case: freezing a non-object primitive returns it unchanged.
test('shallowFreeze — non-object primitives pass through unchanged', () => {
  assert.equal(shallowFreeze(7), 7);
  assert.equal(shallowFreeze('hello'), 'hello');
  assert.equal(shallowFreeze(null), null);
});

// Edge case: Object.isFrozen reports true after shallowFreeze.
test('shallowFreeze — Object.isFrozen returns true for the frozen object', () => {
  const obj = shallowFreeze({ key: 'value' });
  assert.ok(Object.isFrozen(obj));
});
