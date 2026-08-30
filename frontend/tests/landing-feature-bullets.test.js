import { LANDING_BULLETS, renderLandingBullets } from '../lib/landing-feature-bullets';
import { landingFeatureBulletsFixture } from './fixtures/landing-feature-bullets.fixture';

describe('landing feature bullets', () => {
  it('keeps the canonical bullet order and copy', () => {
    expect(renderLandingBullets()).toEqual(LANDING_BULLETS);
    expect(renderLandingBullets().map(({ n, title }) => ({ n, title }))).toEqual(
      landingFeatureBulletsFixture,
    );
  });
});
