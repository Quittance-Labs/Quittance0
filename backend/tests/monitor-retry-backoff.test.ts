import test from 'node:test';
import assert from 'node:assert/strict';
import { monitorBackoffMs } from '../src/utils/monitor-retry-backoff';
import {
  BACKOFF_CASES,
  INVALID_COUNTS,
} from './fixtures/monitor-retry-backoff.fixture';

for (const { failureCount, expected } of BACKOFF_CASES) {
  test(`monitorBackoffMs(${failureCount}) returns ${expected}ms`, () => {
    assert.equal(monitorBackoffMs(failureCount), expected);
  });
}

for (const { failureCount, expected } of INVALID_COUNTS) {
  test(`monitorBackoffMs(${String(failureCount)}) falls back to ${expected}ms`, () => {
    assert.equal(monitorBackoffMs(failureCount), expected);
  });
}
