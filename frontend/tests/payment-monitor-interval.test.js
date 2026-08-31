const test = require('node:test');
const assert = require('node:assert/strict');
const { paymentMonitorInterval, DEFAULT_INTERVAL_MS } = require('../lib/payment-monitor-interval');
const { paymentMonitorIntervalFixture } = require('./fixtures/payment-monitor-interval.fixture');

for (const { name, status, expected } of paymentMonitorIntervalFixture) {
  test(`paymentMonitorInterval ${name}`, () => {
    assert.equal(paymentMonitorInterval(status), expected);
  });
}

test('DEFAULT_INTERVAL_MS is 5000', () => {
  assert.equal(DEFAULT_INTERVAL_MS, 5000);
});
