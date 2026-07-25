const test = require('node:test');
const assert = require('node:assert/strict');
const {
  FREIGHTER_INSTALL_URL,
  FREIGHTER_REQUIRED_MESSAGE,
  detectFreighter,
} = require('../lib/freighter-availability');

test('detectFreighter reports an installed extension', async () => {
  assert.equal(await detectFreighter(async () => true), true);
});

test('detectFreighter reports a missing extension', async () => {
  assert.equal(await detectFreighter(async () => false), false);
});

test('detectFreighter treats extension API failures as missing', async () => {
  assert.equal(
    await detectFreighter(async () => {
      throw new Error('Freighter API unavailable');
    }),
    false
  );
});

test('the install prompt links to the official Freighter site', () => {
  assert.equal(FREIGHTER_INSTALL_URL, 'https://www.freighter.app/');
  assert.match(FREIGHTER_REQUIRED_MESSAGE, /browser extension/);
  assert.match(FREIGHTER_REQUIRED_MESSAGE, /create or pay an invoice/);
});
