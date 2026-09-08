const test = require('node:test');
const assert = require('node:assert/strict');
const { dashboardEmptyMessage } = require('../lib/dashboard-empty-copy');
const { dashboardEmptyCopyFixture } = require('./fixtures/dashboard-empty-copy.fixture');

for (const { walletConnected, output } of dashboardEmptyCopyFixture) {
  test(`dashboardEmptyMessage when walletConnected=${walletConnected}`, () => {
    assert.equal(dashboardEmptyMessage(walletConnected), output);
  });
}
