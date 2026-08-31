const test = require('node:test');
const assert = require('node:assert/strict');
const {
  freighterInstallMessage,
  FREIGHTER_APP_URL,
} = require('../lib/freighter-prompt-copy.ts');
const {
  freighterPromptCopyFixture,
} = require('./fixtures/freighter-prompt-copy.fixture');

for (const { name, variant, expected } of freighterPromptCopyFixture) {
  test(`freighterInstallMessage ${name}`, () => {
    assert.equal(freighterInstallMessage(variant), expected);
  });
}

test('FREIGHTER_APP_URL is defined', () => {
  assert.equal(typeof FREIGHTER_APP_URL, 'string');
  assert.ok(FREIGHTER_APP_URL.startsWith('https://'));
});
