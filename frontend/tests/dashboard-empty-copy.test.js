import { dashboardEmptyMessage } from '../lib/dashboard-empty-copy';
import { dashboardEmptyCopyFixture } from './fixtures/dashboard-empty-copy.fixture';

describe('dashboardEmptyMessage', () => {
  it.each(dashboardEmptyCopyFixture)('returns context-aware copy', ({ walletConnected, output }) => {
    expect(dashboardEmptyMessage(walletConnected)).toBe(output);
  });
});
