import { expirySummary } from '../lib/card-expiry-summary';
import { cardExpirySummaryFixture } from './fixtures/card-expiry-summary.fixture';

describe('expirySummary', () => {
  it.each(cardExpirySummaryFixture)('formats the expiry state', ({ input, expected }) => {
    expect(expirySummary(input)).toBe(expected);
  });
});
