const test = require('node:test');
const assert = require('node:assert/strict');
const { dashboardHistorySortKey } = require('../lib/dashboard-history-sort');
const { dashboardHistorySortFixture } = require('./fixtures/dashboard-history-sort.fixture');

for (const { name, invoice, field, direction, expected } of dashboardHistorySortFixture) {
  test(`dashboardHistorySortKey ${name}`, () => {
    assert.equal(dashboardHistorySortKey(invoice, field, direction), expected);
  });
}
