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
});
