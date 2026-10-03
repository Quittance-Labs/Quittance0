import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  EDGE_CONTROL_DEFAULTS,
  EDGE_CONTROL_ENV_VARS,
  resolveEdgeControlConfig,
} from '../src/middleware/edge-config';

describe('edge control configuration', () => {
  it('lists every edge-control env variable', () => {
    for (const name of [
      'ENABLE_RATE_LIMITING',
      'ENABLE_VERIFY_CONCURRENCY_LOCK',
      'ENABLE_INVOICE_CEILING',
      'DISABLE_VERIFY_CACHE',
      'MAX_BODY_BYTES',
      'MAX_BODY_STRING',
      'INVOICE_CEILING',
      'INVOICE_CEILING_RETRY_AFTER_SECONDS',
      'RATE_LIMIT_WINDOW_MS',
      'RATE_LIMIT_CREATE_PER_MIN',
      'RATE_LIMIT_CREATE_LONG_WINDOW_MS',
      'RATE_LIMIT_CREATE_PER_10MIN',
      'RATE_LIMIT_VERIFY_PER_IP',
      'RATE_LIMIT_VERIFY_PER_INVOICE',
      'RATE_LIMIT_LIST_PER_MIN',
      'RATE_LIMIT_CANCEL_PER_MIN',
      'VERIFY_CONCURRENCY_RETRY_AFTER_SECONDS',
    ]) {
      assert.ok(
        (EDGE_CONTROL_ENV_VARS as readonly string[]).includes(name),
        `missing env var ${name}`
      );
    }
  });

  it('uses safe demo defaults when env is empty', () => {
    const cfg = resolveEdgeControlConfig({});
    assert.equal(cfg.maxBodyBytes, EDGE_CONTROL_DEFAULTS.maxBodyBytes);
    assert.equal(cfg.invoiceCeiling, 5000);
    assert.equal(cfg.createPerMinute, 5);
    assert.equal(cfg.createPerLongWindow, 10);
    assert.equal(cfg.verifyPerIp, 30);
    assert.equal(cfg.verifyPerInvoice, 10);
    assert.equal(cfg.listPerMinute, 60);
    assert.equal(cfg.cancelPerMinute, 10);
  });

  it('reads overrides from env and ignores invalid numbers', () => {
    const cfg = resolveEdgeControlConfig({
      MAX_BODY_BYTES: '8192',
      INVOICE_CEILING: '100',
      RATE_LIMIT_CREATE_PER_MIN: '2',
      RATE_LIMIT_VERIFY_PER_INVOICE: 'not-a-number',
      RATE_LIMIT_WINDOW_MS: '0',
    });
    assert.equal(cfg.maxBodyBytes, 8192);
    assert.equal(cfg.invoiceCeiling, 100);
    assert.equal(cfg.createPerMinute, 2);
    assert.equal(cfg.verifyPerInvoice, EDGE_CONTROL_DEFAULTS.verifyPerInvoice);
    assert.equal(cfg.rateLimitWindowMs, EDGE_CONTROL_DEFAULTS.rateLimitWindowMs);
  });

  it('preserves an exact byte cap without rounding up to a KiB', () => {
    const cfg = resolveEdgeControlConfig({ MAX_BODY_BYTES: '1234' });
    assert.equal(cfg.maxBodyBytes, 1234);
    assert.equal(cfg.maxBodyString, '1234b');
  });

  it('normalizes a valid explicit body-size string into the authoritative byte cap', () => {
    for (const [value, bytes] of [
      ['1kb', 1024], ['1.5 KB', 1536], ['.5kb', 512], ['1.25b', 1],
      ['2mb', 2 * 1024 * 1024], ['1234', 1234],
    ] as const) {
      const cfg = resolveEdgeControlConfig({ MAX_BODY_BYTES: '32768', MAX_BODY_STRING: value });
      assert.equal(cfg.maxBodyBytes, bytes, value);
      assert.equal(cfg.maxBodyString, bytes % 1024 === 0 ? `${bytes / 1024}kb` : `${bytes}b`);
    }
  });

  it('falls back from invalid body-size strings to valid bytes or the safe default', () => {
    for (const value of ['no-limit', '0', '-1kb', 'Infinity', '1kb trailing', '999999999999999999pb']) {
      const cfg = resolveEdgeControlConfig({ MAX_BODY_BYTES: '1234', MAX_BODY_STRING: value });
      assert.equal(cfg.maxBodyBytes, 1234, value);
      assert.equal(cfg.maxBodyString, '1234b');
    }
    for (const value of ['0', '-1', '1.5', '1234junk', '1e4', 'Infinity', '9007199254740992']) {
      const cfg = resolveEdgeControlConfig({ MAX_BODY_BYTES: value, MAX_BODY_STRING: 'invalid' });
      assert.equal(cfg.maxBodyBytes, 16384, value);
      assert.equal(cfg.maxBodyString, '16kb');
    }
  });
});
