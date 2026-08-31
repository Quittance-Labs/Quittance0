const test = require('node:test');
const assert = require('node:assert/strict');
const { freighterPromptMessage, FREIGHTER_APP_URL } = require('../lib/freighter-prompt-message');
const { freighterPromptMessageFixture } = require('./fixtures/freighter-prompt-message.fixture');

for (const { name, action, expected } of freighterPromptMessageFixture) {
  test(`freighterPromptMessage ${name}`, () => {
    assert.equal(freighterPromptMessage(action), expected);
  });
}

test('FREIGHTER_APP_URL is defined', () => {
  assert.equal(typeof FREIGHTER_APP_URL, 'string');
  assert.ok(FREIGHTER_APP_URL.startsWith('https://'));
});
