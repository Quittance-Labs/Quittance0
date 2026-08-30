const test = require('node:test');
const assert = require('node:assert/strict');

function truncateAddress(address, chars = 4) {
  if (!address) return '';
  return `${address.slice(0, chars)}...${address.slice(-chars)}`;
}

test('truncates a G-address-style value to head and tail', () => {
  assert.equal(truncateAddress('GABCDEF1234567890WXYZ'), 'GABC...WXYZ');
});

test('returns an empty string for an empty address', () => {
  assert.equal(truncateAddress(''), '');
});
