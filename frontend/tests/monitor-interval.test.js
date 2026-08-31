const test = require('node:test');
const assert = require('node:assert/strict');
const { monitorIntervalMs } = require('../lib/monitor-interval.ts');
const { monitorIntervalFixture } = require('./fixtures/monitor-interval.fixture');

for (const { name, attempt, expected } of monitorIntervalFixture) {
  test(`monitorIntervalMs ${name}`, () => {
    assert.equal(monitorIntervalMs(attempt), expected);
  });
}
