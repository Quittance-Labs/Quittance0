import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  monitorBackoffMs,
  BACKOFF_BASE_MS,
  BACKOFF_FACTOR,
  BACKOFF_MAX_MS,
} from '../src/utils/monitor-retry-backoff';
import {
  BACKOFF_CASES,
  MALFORMED_INPUT_CASES,
} from './fixtures/monitor-retry-backoff.fixture';

describe('BACKOFF constants', () => {
  it('base delay is 1000ms (1 second)', () => {
    assert.equal(BACKOFF_BASE_MS, 1_000);
  });

  it('factor is 2 (classic exponential doubling)', () => {
    assert.equal(BACKOFF_FACTOR, 2);
  });

  it('max delay is 30000ms (30 seconds)', () => {
    assert.equal(BACKOFF_MAX_MS, 30_000);
  });
});

describe('monitorBackoffMs — contract fixtures', () => {
  for (const fixture of BACKOFF_CASES) {
    it(fixture.name, () => {
      const result = monitorBackoffMs(fixture.failureCount);
      assert.equal(result, fixture.expectedDelay);
    });
  }
});

describe('monitorBackoffMs — malformed input rejection', () => {
  for (const fixture of MALFORMED_INPUT_CASES) {
    it(fixture.name, () => {
      const result = monitorBackoffMs(fixture.failureCount);
      assert.equal(result, fixture.expectedDelay);
    });
  }
});

describe('monitorBackoffMs — direct edge cases', () => {
  it('returns an integer for all valid inputs', () => {
    for (let i = 0; i <= 20; i++) {
      const result = monitorBackoffMs(i);
      assert.equal(Number.isInteger(result), true);
    }
  });

  it('never exceeds the ceiling regardless of failure count', () => {
    assert.ok(monitorBackoffMs(10) <= BACKOFF_MAX_MS);
    assert.ok(monitorBackoffMs(50) <= BACKOFF_MAX_MS);
    assert.ok(monitorBackoffMs(1000) <= BACKOFF_MAX_MS);
  });

  it('monotonically increases up to the ceiling', () => {
    let prev = 0;
    for (let i = 0; i <= 10; i++) {
      const curr = monitorBackoffMs(i);
      assert.ok(curr >= prev, `delay decreased at failureCount=${i}`);
      prev = curr;
    }
  });

  it('handles failureCount 0 as base delay (first attempt)', () => {
    assert.equal(monitorBackoffMs(0), BACKOFF_BASE_MS);
  });
});

export default monitorBackoffMs;
