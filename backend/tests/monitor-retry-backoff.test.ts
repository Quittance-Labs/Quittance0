import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  monitorBackoffMs,
  DEFAULT_MONITOR_BASE_BACKOFF_MS,
  DEFAULT_MONITOR_MAX_BACKOFF_MS,
  DEFAULT_MONITOR_BACKOFF_FACTOR,
} from '../src/utils/monitor-retry-backoff';
import {
  DEFAULT_BACKOFF_FIXTURES,
  EDGE_CASE_FIXTURES,
} from './fixtures/monitor-retry-backoff.fixture';

describe('monitorBackoffMs — default constants', () => {
  it('defines canonical constants', () => {
    assert.equal(DEFAULT_MONITOR_BASE_BACKOFF_MS, 1000);
    assert.equal(DEFAULT_MONITOR_MAX_BACKOFF_MS, 30000);
    assert.equal(DEFAULT_MONITOR_BACKOFF_FACTOR, 2);
  });
});

describe('monitorBackoffMs — exponential scaling and capping', () => {
  for (const fixture of DEFAULT_BACKOFF_FIXTURES) {
    it(fixture.description, () => {
      const delay = monitorBackoffMs(fixture.failureCount);
      assert.equal(delay, fixture.expectedMs);
    });
  }
});

describe('monitorBackoffMs — edge cases and invalid inputs', () => {
  for (const fixture of EDGE_CASE_FIXTURES) {
    it(fixture.description, () => {
      const delay = monitorBackoffMs(fixture.input);
      assert.equal(delay, fixture.expectedMs);
    });
  }
});

describe('monitorBackoffMs — custom options', () => {
  it('supports custom base, max, and factor', () => {
    const delay = monitorBackoffMs(3, { baseMs: 500, maxMs: 10000, factor: 3 });
    // 500 * 3^(3-1) = 500 * 9 = 4500
    assert.equal(delay, 4500);
  });

  it('respects lower max limit', () => {
    const delay = monitorBackoffMs(5, { baseMs: 1000, maxMs: 3000, factor: 2 });
    assert.equal(delay, 3000);
  });
});
