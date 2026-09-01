import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  monitorBackoffMs,
  isValidFailureCount,
  DEFAULT_INITIAL_DELAY_MS,
  DEFAULT_MAX_DELAY_MS,
  DEFAULT_BACKOFF_FACTOR,
} from '../src/utils/monitor-retry-backoff';
import {
  STANDARD_BACKOFF_CASES,
  CUSTOM_OPTIONS_CASES,
  INVALID_INPUT_CASES,
  VALIDATION_CASES,
} from './fixtures/monitor-retry-backoff.fixture';

describe('monitor retry backoff constants', () => {
  it('defines the default initial delay as 1000ms (1 second)', () => {
    assert.equal(DEFAULT_INITIAL_DELAY_MS, 1000);
  });

  it('defines the default max delay cap as 30000ms (30 seconds)', () => {
    assert.equal(DEFAULT_MAX_DELAY_MS, 30000);
  });

  it('defines the default backoff multiplier factor as 2', () => {
    assert.equal(DEFAULT_BACKOFF_FACTOR, 2);
  });
});

describe('monitorBackoffMs — standard exponential progression (contract fixtures)', () => {
  for (const testCase of STANDARD_BACKOFF_CASES) {
    it(testCase.name, () => {
      const actual = monitorBackoffMs(testCase.failureCount);
      assert.equal(actual, testCase.expectedDelayMs);
    });
  }
});

describe('monitorBackoffMs — custom configuration options', () => {
  for (const testCase of CUSTOM_OPTIONS_CASES) {
    it(testCase.name, () => {
      const actual = monitorBackoffMs(testCase.failureCount, testCase.options);
      assert.equal(actual, testCase.expectedDelayMs);
    });
  }
});

describe('monitorBackoffMs — invalid input fallbacks', () => {
  for (const testCase of INVALID_INPUT_CASES) {
    it(testCase.name, () => {
      const actual = monitorBackoffMs(testCase.failureCount as number, testCase.options);
      assert.equal(actual, testCase.expectedDelayMs);
    });
  }
});

describe('isValidFailureCount — validation cases', () => {
  for (const testCase of VALIDATION_CASES) {
    it(testCase.name, () => {
      const actual = isValidFailureCount(testCase.input);
      assert.equal(actual, testCase.expectedValid);
    });
  }
});

describe('monitorBackoffMs — direct edge cases and invariant properties', () => {
  it('is strictly monotonic: delay at failure (n+1) is >= delay at failure n', () => {
    for (let i = 0; i < 20; i++) {
      const current = monitorBackoffMs(i);
      const next = monitorBackoffMs(i + 1);
      assert.ok(
        next >= current,
        `Expected backoff(${i + 1}) [${next}] >= backoff(${i}) [${current}]`
      );
    }
  });

  it('never exceeds DEFAULT_MAX_DELAY_MS across arbitrary failure counts', () => {
    for (let i = 0; i < 100; i++) {
      const delay = monitorBackoffMs(i);
      assert.ok(
        delay <= DEFAULT_MAX_DELAY_MS,
        `Delay ${delay} exceeded max cap of ${DEFAULT_MAX_DELAY_MS}`
      );
    }
  });

  it('never returns a delay less than DEFAULT_INITIAL_DELAY_MS for valid counts', () => {
    for (let i = 0; i < 20; i++) {
      const delay = monitorBackoffMs(i);
      assert.ok(
        delay >= DEFAULT_INITIAL_DELAY_MS,
        `Delay ${delay} was less than initial delay ${DEFAULT_INITIAL_DELAY_MS}`
      );
    }
  });

  it('handles fractional / floating point failure counts safely', () => {
    const delay = monitorBackoffMs(1.5);
    assert.ok(Number.isFinite(delay));
    assert.ok(delay >= DEFAULT_INITIAL_DELAY_MS);
    assert.ok(delay <= DEFAULT_MAX_DELAY_MS);
  });

  it('falls back gracefully when given invalid options', () => {
    // negative initialDelayMs falls back to default
    assert.equal(
      monitorBackoffMs(0, { initialDelayMs: -500 }),
      DEFAULT_INITIAL_DELAY_MS
    );
    // maxDelayMs smaller than initialDelay falls back to default
    assert.equal(
      monitorBackoffMs(5, { initialDelayMs: 2000, maxDelayMs: 1000 }),
      DEFAULT_MAX_DELAY_MS
    );
    // factor smaller than 1 falls back to default factor 2
    assert.equal(
      monitorBackoffMs(1, { factor: 0.5 }),
      2000
    );
  });
});

export default monitorBackoffMs;
