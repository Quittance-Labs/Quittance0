import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createRequestId,
  isValidRequestId,
  formatRequestLog,
  DEFAULT_REQUEST_ID_PREFIX,
  REQUEST_ID_LENGTH,
} from '../src/utils/request-correlation-id';
import {
  VALID_CONFIG_FIXTURES,
  INVALID_ID_CANDIDATES,
  VALID_ID_CANDIDATES,
} from './fixtures/request-correlation-id.fixture';

describe('createRequestId — default generation', () => {
  it('generates a string starting with the default prefix req_', () => {
    const id = createRequestId();
    assert.equal(typeof id, 'string');
    assert.ok(id.startsWith(DEFAULT_REQUEST_ID_PREFIX));
    assert.equal(id.length, DEFAULT_REQUEST_ID_PREFIX.length + REQUEST_ID_LENGTH);
  });

  it('generates unique IDs across 500 consecutive invocations', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 500; i++) {
      const id = createRequestId();
      assert.ok(!seen.has(id), `Collision detected for ${id}`);
      seen.add(id);
    }
    assert.equal(seen.size, 500);
  });
});

describe('createRequestId — custom prefix and size', () => {
  for (const fixture of VALID_CONFIG_FIXTURES) {
    it(`supports prefix ${fixture.expectedPrefix} with expected min length ${fixture.expectedMinLength}`, () => {
      const id = createRequestId(fixture.prefix, fixture.size);
      assert.ok(id.startsWith(fixture.expectedPrefix));
      assert.ok(id.length >= fixture.expectedMinLength);
    });
  }

  it('falls back gracefully when given non-finite or negative size', () => {
    const idNegative = createRequestId('test_', -5);
    assert.ok(idNegative.startsWith('test_'));
    assert.equal(idNegative.length, 'test_'.length + REQUEST_ID_LENGTH);

    const idNaN = createRequestId('test_', Number.NaN);
    assert.ok(idNaN.startsWith('test_'));
    assert.equal(idNaN.length, 'test_'.length + REQUEST_ID_LENGTH);
  });

  it('falls back to DEFAULT_REQUEST_ID_PREFIX when given a non-string prefix', () => {
    // @ts-expect-error Testing invalid prefix type
    const id = createRequestId(null, 10);
    assert.ok(id.startsWith(DEFAULT_REQUEST_ID_PREFIX));
    assert.equal(id.length, DEFAULT_REQUEST_ID_PREFIX.length + 10);
  });
});

describe('isValidRequestId', () => {
  for (const candidate of INVALID_ID_CANDIDATES) {
    it(`rejects invalid candidate ${JSON.stringify(candidate)}`, () => {
      assert.equal(isValidRequestId(candidate), false);
    });
  }

  for (const item of VALID_ID_CANDIDATES) {
    it(`evaluates ${item.id} against prefix ${item.prefix} -> ${item.valid}`, () => {
      assert.equal(isValidRequestId(item.id, item.prefix), item.valid);
    });
  }
});

describe('formatRequestLog', () => {
  it('decorates a log message with correlation id tag', () => {
    const id = 'req_test123';
    const msg = 'Invoice payment status queried';
    const log = formatRequestLog(id, msg);
    assert.equal(log, '[req_test123] Invoice payment status queried');
  });

  it('uses fallback tag when request id is empty', () => {
    const log = formatRequestLog('', 'Fallback error occurred');
    assert.equal(log, '[req_unknown] Fallback error occurred');
  });
});
