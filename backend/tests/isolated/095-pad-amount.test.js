import test from 'node:test';
import assert from 'node:assert/strict';

const padAmount = (value) => Number(value).toFixed(2);

test('pads a fractional amount to two decimal places', () => {
  assert.equal(padAmount('12.5'), '12.50');
});

test('adds two decimal places to a whole amount', () => {
  assert.equal(padAmount(0), '0.00');
});
