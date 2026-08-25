const test = require('node:test');
const assert = require('node:assert/strict');

function emailHasAt(email) {
  return typeof email === 'string' && email.includes('@');
}

test('accepts emails containing @', () => {
  assert.equal(emailHasAt('billing@quittance.example'), true);
  assert.equal(emailHasAt('a@b'), true);
});

test('rejects values without an @', () => {
  assert.equal(emailHasAt('billing.quittance.example'), false);
  assert.equal(emailHasAt(''), false);
  assert.equal(emailHasAt(null), false);
  assert.equal(emailHasAt(undefined), false);
});
