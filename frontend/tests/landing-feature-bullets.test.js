const test = require('node:test');
const assert = require('node:assert/strict');
const { LANDING_BULLETS, renderLandingBullets } = require('../lib/landing-feature-bullets');
const { landingFeatureBulletsFixture } = require('./fixtures/landing-feature-bullets.fixture');

test('landing feature bullets keep the canonical bullet order and copy', () => {
  assert.deepEqual(renderLandingBullets(), LANDING_BULLETS);
  assert.deepEqual(
    renderLandingBullets().map(({ n, title }) => ({ n, title })),
    landingFeatureBulletsFixture,
  );
});
